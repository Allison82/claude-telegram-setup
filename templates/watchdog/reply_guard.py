#!/usr/bin/env python3
"""bot 回覆了卻沒呼叫 reply 工具時，自動補傳到 TG（2026-11-03 建立）。

11-02 晚上 bot 的回覆全寫在終端文字、沒呼叫 reply 工具，使用者在 TG 只看到 👀，
等了好幾個小時。這裡每 2 分鐘看一次常駐 session 的 transcript：
使用者私訊進來的訊息之後，bot 寫了文字回覆、卻整段都沒呼叫 telegram 工具，
而且已經停了 3 分鐘（這一輪做完了）→ 把那段文字用 Bot API 直接傳給使用者。
只處理使用者的私訊；群組不補傳（群組回覆要 bot 自己判斷）。

由 check_and_reconnect.sh 每 2 分鐘呼叫一次。
"""
import calendar
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import auto_repair as ar  # 共用 plist / TG 通知

STATE = os.path.join(ar.BASE_DIR, "reply_guard_state.json")
IDLE_SECONDS = 180      # 最後一個動作後 3 分鐘才算這一輪結束
TAIL_BYTES = 3000000


def epoch(s):
    return calendar.timegm(time.strptime(s[:19], "%Y-%m-%dT%H:%M:%S"))


def load():
    try:
        with open(STATE) as f:
            return json.load(f)
    except Exception:
        return {}


def main():
    s = load()
    with open(os.path.join(ar.TG_DIR, "access.json")) as f:
        me = str(json.load(f)["allowFrom"][0])
    sid, _ = ar.plist_args(ar.read_plist())
    path = os.path.join(ar.PROJECT_DIR, sid + ".jsonl")
    with open(path, "rb") as f:
        f.seek(max(0, os.path.getsize(path) - TAIL_BYTES))
        lines = f.read().decode("utf-8", "replace").split("\n")[1:]

    # 切成「使用者的一則私訊 → 之後 bot 做的事」一段一段
    spans, cur, last_ts = [], None, None
    for line in lines:
        try:
            d = json.loads(line)
        except Exception:
            continue
        t = d.get("timestamp")
        if not t:
            continue
        last_ts = t
        c = (d.get("message") or {}).get("content")
        if d.get("type") == "user" and isinstance(c, str) and "<channel source=\"plugin:telegram" in c:
            if cur:
                spans.append(cur)
            dm = 'chat_id="%s"' % me in c
            cur = {"ts": t, "dm": dm, "texts": [], "replied": False}
            continue
        if cur is None or d.get("type") != "assistant" or not isinstance(c, list):
            continue
        for x in c:
            if x.get("type") == "text" and x.get("text", "").strip():
                cur["texts"].append(x["text"].strip())
            elif x.get("type") == "tool_use" and "plugin_telegram" in x.get("name", ""):
                cur["replied"] = True
    if cur:
        spans.append(cur)
    if not spans or not last_ts:
        return

    done = s.get("done", "")
    if not done:  # 第一次跑：不追溯舊的
        s["done"] = spans[-1]["ts"]
    else:
        idle = time.time() - epoch(last_ts) >= IDLE_SECONDS
        for i, sp in enumerate(spans):
            if sp["ts"] <= done:
                continue
            finished = i < len(spans) - 1 or idle
            if not finished:
                break
            if sp["dm"] and sp["texts"] and not sp["replied"]:
                body = "\n\n".join(sp["texts"]).replace("**", "")
                ar.tg_notify("（機器人剛剛忘了傳，自動補上👇）\n\n" + body[:3800])
                ar.log("reply_guard: %s 那則沒呼叫 reply，已補傳 %d 字" % (sp["ts"], len(body)))
            s["done"] = sp["ts"]
    with open(STATE, "w") as f:
        json.dump(s, f, indent=2)


if __name__ == "__main__":
    main()
