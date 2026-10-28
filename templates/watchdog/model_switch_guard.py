#!/usr/bin/env python3
"""常駐 bot 卡在「Model switch」選單時自動處理（2026-10-27 建立）。

Opus 5.5 的安全機制擋下一則回覆後，Claude Code 會在 bot 的終端畫面跳出
「Model switch … Switch to Opus 4.8?」選單等人選。bot 跑在 launchd 底下，
沒人看得到那個畫面，之後的 TG 訊息只會被按 👀、不會回。
（用原模型重啟沒用：--resume 之後會馬上再跳同一個選單。）

處理方式：先通知使用者，2 分鐘內沒處理就自動選一個。
  - 偵測到選單 → TG 通知（使用者在電腦前可以自己選）
  - 2 分鐘後 bot 還是沒有新回覆 → 把 plist 的 --model 改成 FALLBACK_MODEL，
    重新載入（等同選單「換模型繼續」，記憶保留），再 TG 通知重傳訊息

由 check_and_reconnect.sh 每 2 分鐘呼叫一次，需要同資料夾的 auto_repair.py。
FALLBACK_MODEL 請改成選單上建議的那個模型，並先用
  claude -p --model <模型> "只回覆 OK"
確認可以用。
"""
import calendar
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import auto_repair as ar  # 共用 plist / 重新載入 / TG 通知

OUT_LOG = os.path.join(ar.TG_DIR, "launchd.out.log")
STATE = os.path.join(ar.BASE_DIR, "model_switch_state.json")
FALLBACK_MODEL = "claude-opus-4-8"   # 選單上建議切換的模型
WAIT_SECONDS = 120                   # 等使用者自己處理的時間
COOLDOWN = 1800                      # 處理過後 30 分鐘內不再動，避免重啟循環
ANSI = re.compile(rb"\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07")


def load():
    try:
        with open(STATE) as f:
            return json.load(f)
    except Exception:
        return {}


def save(s):
    with open(STATE, "w") as f:
        json.dump(s, f, indent=2)


def dialog_in(chunk):
    # 終端畫面用游標移動排版，空白常被吃掉，所以去掉空白再比對
    t = re.sub(rb"\s+", b"", ANSI.sub(b"", chunk)).lower()
    return b"modelswitch" in t and b"safeguards" in t


def bot_replied_since(ts):
    """transcript 裡 ts 之後有沒有 assistant 的新內容（卡住時只會寫入進來的訊息，所以不能只看檔案修改時間）。"""
    sid, _ = ar.plist_args(ar.read_plist())
    path = os.path.join(ar.PROJECT_DIR, sid + ".jsonl")
    try:
        with open(path, "rb") as f:
            f.seek(max(0, os.path.getsize(path) - 300000))
            tail = f.read().decode("utf-8", "replace").split("\n")[1:]
    except OSError:
        return False
    for line in reversed(tail):
        if '"type":"assistant"' not in line:
            continue
        try:
            d = json.loads(line)
            t = calendar.timegm(time.strptime(d["timestamp"][:19], "%Y-%m-%dT%H:%M:%S"))
            return t > ts
        except Exception:
            continue
    return False


def main():
    s = load()
    now = int(time.time())
    size = os.path.getsize(OUT_LOG)
    off = s.get("offset")
    if off is None or off > size:
        s["offset"] = size  # 第一次跑：從現在開始看，不追溯
        save(s)
        return
    with open(OUT_LOG, "rb") as f:
        f.seek(off)
        chunk = f.read()
    s["offset"] = size

    if not s.get("pending"):
        if dialog_in(chunk) and now - s.get("last_action", 0) > COOLDOWN:
            s["pending"] = now
            ar.log("model_switch: 偵測到換模型選單，已通知，%d 秒後自動處理" % WAIT_SECONDS)
            ar.tg_notify("⚠️ 機器人有一則回覆被安全機制擋下，停在「要不要換模型」的選單，現在收不到訊息。\n"
                         "在電腦前的話可以直接在選單選；2 分鐘內沒處理，會自動換成 %s 繼續（記憶保留）。" % FALLBACK_MODEL)
        save(s)
        return

    if now - s["pending"] < WAIT_SECONDS:
        save(s)
        return
    if bot_replied_since(s["pending"]):
        ar.log("model_switch: 使用者已自己處理（bot 有新回覆），不動")
        s.pop("pending")
        save(s)
        return

    p = ar.read_plist()
    _, cur = ar.plist_args(p)
    if cur != FALLBACK_MODEL:
        ar.write_plist(p, model=FALLBACK_MODEL)
    ar.reload_service()
    time.sleep(5)
    s["offset"] = os.path.getsize(OUT_LOG)
    s["last_action"] = now
    s.pop("pending")
    save(s)
    ar.log("model_switch: 2 分鐘沒處理，已改用 %s 重新載入（原 %s）" % (FALLBACK_MODEL, cur))
    ar.tg_notify("🔧 已自動換成 %s 繼續，記憶都還在。\n" % FALLBACK_MODEL + "剛剛只按了 👀 沒回的訊息，請再傳一次。")


if __name__ == "__main__":
    main()
