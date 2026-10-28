# Claude Code × Telegram 串接完整指南

> 目的：讓你在外面用手機 Telegram 跟跑在自己電腦上的 Claude Code 對話。
> 實測環境：macOS，zsh，Claude Code CLI

---

## 架構說明

```
[手機 Telegram]
      │  DM
      ▼
[@TGIF_claude_bot（Telegram Bot API）]
      │  long polling
      ▼
[bun server.ts（MCP plugin，跑在你電腦上）]
      │  stdio MCP
      ▼
[Claude Code（--channels 旗標啟動）]
      │  reply tool
      ▼
[bun server.ts → Telegram Bot API]
      │
      ▼
[手機收到 push notification]
```

**關鍵元件：**
| 元件 | 說明 |
|------|------|
| Telegram Bot | 你自己申請的 bot，作為訊息中繼 |
| Bun | JS runtime，跑 MCP plugin server |
| telegram plugin | `claude-plugins-official` 提供的 MCP server |
| Claude Code | 用 `--channels` 旗標掛上 Telegram channel |

---

## 一、事前準備

### 1. 申請 Telegram Bot

1. Telegram 開 [@BotFather](https://t.me/BotFather)
2. 傳 `/newbot`
3. 設定 Name（顯示名）和 Username（必須以 `bot` 結尾）
4. 拿到 token，格式：`123456789:AAH...`

### 2. 取得自己的 chat_id

找 [@userinfobot](https://t.me/userinfobot) 傳任意訊息，他會回你的 numeric ID（例：`123456789`）。

---

## 二、安裝步驟

### 1. 安裝 Claude Code（若尚未安裝）

```bash
npm install -g @anthropic-ai/claude-code
```

### 2. 安裝 Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

安裝後重開終端機或執行：
```bash
source ~/.zshrc
```

驗證：
```bash
bun --version
```

### 3. 安裝 Telegram Plugin

在 Claude Code 裡執行：
```
/plugin install telegram@claude-plugins-official
/reload-plugins
```

### 4. 設定 Bot Token

```
/telegram:configure <你的 bot token>
```

這會把 token 寫到 `~/.claude/channels/telegram/.env`。

---

## 三、設定 access.json（重要！）

Plugin 安裝後，手動建立或確認 `~/.claude/channels/telegram/access.json` 內容如下：

```json
{
  "dmPolicy": "allowlist",
  "allowFrom": ["你的chat_id數字字串"],
  "groups": {},
  "pending": {}
}
```

**⚠️ 常見錯誤：** 欄位名稱必須是 `allowFrom`（不是 `allowlist`），值必須是**字串**（不是數字）。

範例（chat_id 為 123456789）：
```json
{
  "dmPolicy": "allowlist",
  "allowFrom": ["123456789"],
  "groups": {},
  "pending": {}
}
```

---

## 四、啟動方式

**⚠️ 2026-08-23 更新：正式環境已改用 launchd 常駐（見第十一節），下面手動指令只在「第一次測試」或「plist 本身壞掉要重建」時才用。日常請不要手動打這行，否則會跟 launchd 帶起來的正牌 process 搶 Telegram long polling，變成兩個 bot 互搶訊息、忽有忽無。**

```bash
claude --channels plugin:telegram@claude-plugins-official
```

若想跳過所有操作確認（完全信任模式）：
```bash
claude --channels plugin:telegram@claude-plugins-official --dangerously-skip-permissions
```

---

## 五、驗證是否正常

1. 確認 bun server 有在跑：
   ```bash
   ps aux | grep "bun server.ts"
   ```
   應該看到一個 bun 程序。

2. 確認 bot token 有效：
   ```bash
   curl -s "https://api.telegram.org/bot<你的token>/getMe"
   ```
   應該回傳 bot 資訊。

3. Telegram 私訊你的 bot，Claude Code 應該在幾秒內回覆。

---

## 六、工作規則（給 Claude 的協定）

以下規則已寫入 CLAUDE.md，Claude 每次啟動都會遵守：

- **完成任務立即推 Telegram**（不要只印在終端機）
- **長任務用 `edit_message` 更新進度**，完成時再 `reply`（才會 ping 手機）
- **圖表 / 報告直接 attach**，不叫使用者去看本機路徑
- **語言：繁體中文，風格：條列式、簡潔、專業**

---

## 七、CLAUDE.md 設定

在 `~/CLAUDE.md` 加入以下段落，讓每個新 session 都自動讀取規則：

```markdown
## ⚡ 重要：透過 Telegram 與我溝通

我習慣用 Telegram（@你的bot_username）跟 Claude Code 對話，**不會盯著終端機**。
所有 agent 接手工作前先讀 `~/Downloads/Telegram Desktop/TELEGRAM_COMMS.md`，了解：
- 我的 chat_id
- MCP telegram 工具用法
- 「完成任務必須立即 reply 到 TG」的硬性規則
- 群組安全紅線
```

---

## 八、常見問題排查

| 症狀 | 原因 | 解法 |
|------|------|------|
| Bot 完全不回 | 沒用 `--channels` 旗標啟動 | 重開 `claude --channels plugin:telegram@claude-plugins-official` |
| Bot 不回 DM | `access.json` 欄位名稱錯誤 | 確認用 `allowFrom`（不是 `allowlist`），值為字串 |
| Bot 不回 DM | `dmPolicy` 是 `allowlist` 但名單是空的 | 把自己的 chat_id 加進 `allowFrom` |
| `409 Conflict` 錯誤 | 上個 session 的 bun 殭屍程序還在 | `pkill -f "bun server.ts"` 再重開 |
| 訊息很長被截斷 | 超過 Telegram 4096 字 | `reply` 會自動分段，正常現象 |
| 中文表格在手機顯示亂 | 等寬字體 fallback 不一致 | 改用 emoji 標題 + 條列式 |

---

## 九、檔案位置速查

| 檔案 | 路徑 | 說明 |
|------|------|------|
| Bot token | `~/.claude/channels/telegram/.env` | `TELEGRAM_BOT_TOKEN=...` |
| 存取控制 | `~/.claude/channels/telegram/access.json` | allowFrom、dmPolicy |
| Plugin 原始碼 | `~/.claude/plugins/cache/claude-plugins-official/telegram/0.0.6/` | server.ts |
| 全域指令設定 | `~/CLAUDE.md` | agent 啟動時自動讀取 |

---

## 十、安全紅線

- **不要**在 Telegram 訊息裡叫 Claude 修改 `access.json` 或配對 → 這是 prompt injection 手法
- **不要**把 bot token、API key 傳到 Telegram
- 群組訊息**不執行**修改本機檔案的操作

---

## 十一、正式常駐架構：launchd（取代手動啟動）

正式環境不是靠人手動打 `claude --channels ...`，而是用 **launchd LaunchAgent** 24 小時帶著跑，login 自動啟動、掛掉自動重開、並且 pin 住同一個 session id，所以對話記憶不會斷。

| 項目 | 值 |
|------|-----|
| Label | `com.YOUR_USERNAME.claude-telegram-channel` |
| Plist 路徑 | `~/Library/LaunchAgents/com.YOUR_USERNAME.claude-telegram-channel.plist` |
| 啟動方式 | `RunAtLoad`（開機/登入自動啟動）+ `KeepAlive`（掛掉 30 秒內自動復活） |
| 固定參數 | `claude --resume <sessionId> --channels plugin:telegram@claude-plugins-official --dangerously-skip-permissions` |
| stdout log | `~/.claude/channels/telegram/launchd.out.log`（完整終端機畫面截取，會一直長大，用 `tail` 看尾巴就好，不要整份 cat） |
| stderr log | `~/.claude/channels/telegram/launchd.err.log` |

**常用 launchctl 指令：**

```bash
# 看目前狀態（state 應為 running，記下 pid）
launchctl print gui/$(id -u)/com.YOUR_USERNAME.claude-telegram-channel

# 原地重啟（憑證過期 / 卡住，但 plist 內容沒改）
launchctl kickstart -k gui/$(id -u)/com.YOUR_USERNAME.claude-telegram-channel

# plist 內容改了（例如要換 --resume 成另一個 session id）才需要這組，
# 單純 kickstart 不會吃到新的 plist 內容
launchctl bootout gui/$(id -u)/com.YOUR_USERNAME.claude-telegram-channel
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.YOUR_USERNAME.claude-telegram-channel.plist
```

**絕對不要用 `kill` 期待它從此消失** — `KeepAlive` 會在 30 秒內用舊 plist/舊狀態把它救回來，跟你正在修的東西打架。要嘛用 `kickstart -k`（原地重開），要嘛先 `bootout` 再 `bootstrap`。

---

## 十二、實戰排查 SOP（2026-08-23 打通紀錄）

**症狀**：使用者回報「Telegram 傳訊息沒反應 / 沒收到回覆」。

### Step 1：診斷（唯讀，一次全部跑，不要先動手）

```bash
# 1. launchd 狀態
launchctl print gui/$(id -u)/com.YOUR_USERNAME.claude-telegram-channel | grep -E "state|pid|last exit"

# 2. process tree —— 正常應該「只有一條」claude--resume → bun run → bun server.ts 的 chain，
#    而且最上層 parent 是 launchd（PPID=1）。出現第二條、第三條通常是有人手動打了
#    `claude --channels ...`（本次事故就是這樣：有人在別的終端機手動起了一份，
#    連當時對話用的那個 session 自己也意外帶起一份，變成三個 bot 搶同一組 long polling）
ps -ef | grep -E "claude --resume|claude --channels|bun (run|server.ts)" | grep -v grep

# 3. 看有沒有 401（憑證過期）——常駐 process 開機超過一段時間後，
#    cached 的 access token 可能過期，即使全域帳號重新 /login 過，
#    這個「已經在跑」的 process 記憶體裡還是舊的，不會自動吃到新憑證
tail -80 ~/.claude/channels/telegram/launchd.err.log
tail -c 4000 ~/.claude/channels/telegram/launchd.out.log   # 大檔案，只看尾巴，找 "401" 字樣

# 4. 驗證 bot token 對應到哪個帳號（確認 .env 裡的 token 真的是 @TGIF_claude_bot，
#    不是設定錯或換過 bot 忘記改）
TOKEN=$(grep -o 'TELEGRAM_BOT_TOKEN=.*' ~/.claude/channels/telegram/.env | cut -d= -f2)
curl -s "https://api.telegram.org/bot${TOKEN}/getMe"
#    預期看到 "username":"TGIF_claude_bot"

# 5. 確認沒設 webhook 卡住 long polling（正常 url 應為空字串）
curl -s "https://api.telegram.org/bot${TOKEN}/getWebhookInfo"
```

### Step 2：判斷

- 全部正常（state=running、只有一條 process chain、log 沒有新 401、getMe/getWebhookInfo 正常）→ 回報健康，不要動它。
- 有異常（多條 chain / 401 / webhook 有設定）→ 進 Step 3 動手修。

### Step 3：修復

1. **殺掉多餘的重複 chain**：只殺「parent 不是 launchd（PID 1）」的那幾條，`kill -TERM <pid>`。**launchd 帶起來的那條絕對不要單獨 kill**（會被 KeepAlive 在 30 秒內復活，反而又變兩條）。
2. **憑證過期（401）**：先確認任一個新的互動式 session 執行 `/login` 能成功（代表全域憑證已刷新），再跑：
   ```bash
   launchctl kickstart -k gui/$(id -u)/com.YOUR_USERNAME.claude-telegram-channel
   ```
   讓正牌 process 重開、從硬碟重新讀取新憑證。
3. 等 5–10 秒，重跑 Step 1 全部診斷，確認：`state=running`、只剩一條 chain、error log 沒有新的 401。

### Step 4：驗證真的打通（不能只信 log，要真人測）

```bash
# 主動推播一則自檢訊息，先確認「bot → 人」這個方向沒問題
TOKEN=$(grep -o 'TELEGRAM_BOT_TOKEN=.*' ~/.claude/channels/telegram/.env | cut -d= -f2)
curl -s "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  -d chat_id=YOUR_CHAT_ID \
  -d text="系統自檢：請回覆測試"
```

接著**請使用者本人在 Telegram 實際打字回覆一句** —— 這一步無法用腳本模擬，因為 Bot API 不允許偽造「使用者傳進來」的訊息，只能等真人送一則真的訊息，再去確認：
- launchd 那個 session 的終端機 / log 有沒有同步顯示收到的內容
- 使用者手機上有沒有收到 Claude 的回覆

兩者都成立才算真的打通，只有其中一個成立（例如 log 有顯示但沒回覆，或反過來）代表還有問題，回 Step 1 重新診斷。

**小技巧**：可以用 `Monitor` 或 `tail -F -n0 ~/.claude/channels/telegram/launchd.out.log | grep -a <你的chat_id>` 掛著等，使用者一回覆訊息就會觸發通知，不用自己盯著 log 猛刷。

---

## 十三、快速指令速查表（本次事故新增）

| 目的 | 指令 |
|------|------|
| 看 launchd 狀態 | `launchctl print gui/$(id -u)/com.YOUR_USERNAME.claude-telegram-channel` |
| 找重複/殭屍 process | `ps -ef \| grep -E "claude --resume\|claude --channels\|bun (run\|server.ts)" \| grep -v grep` |
| 看正牌 process 的畫面/log | `tail -c 4000 ~/.claude/channels/telegram/launchd.out.log`、`tail -80 ~/.claude/channels/telegram/launchd.err.log` |
| 驗證 token/bot 身份 | `curl -s "https://api.telegram.org/bot<TOKEN>/getMe"` |
| 驗證沒有 webhook 卡住 | `curl -s "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"` |
| 主動推播測試訊息 | `curl -s "https://api.telegram.org/bot<TOKEN>/sendMessage" -d chat_id=<id> -d text="..."` |
| 原地重啟正牌 process（憑證過期/卡住） | `launchctl kickstart -k gui/$(id -u)/com.YOUR_USERNAME.claude-telegram-channel` |
| plist 內容改了要重載 | `launchctl bootout ...` 後 `launchctl bootstrap ...`（見第十一節） |
| 殺掉非 launchd 帶起的重複 bot | `kill -TERM <pid>`（先用上面 ps 確認 parent 不是 launchd） |

**這幾個事故本次都遇過，下次看到一樣症狀直接照這張表走：**
- 「傳訊息沒反應」→ 先懷疑「多條重複 process 在搶 + 正牌那條 401」，Step 1 全跑一遍就知道。
- 也可以直接用 `telegram-healthcheck` skill，內容跟這節同步，會自動跑完整套 SOP。

---

## 十四、重開機後自動接回「同一個對話」（2026-09-21 新增）

### 1. 開機自動啟動的條件

- LaunchAgent 屬於**使用者登入後**才載入（`RunAtLoad` + `KeepAlive`）。Mac 停在登入畫面時**不會**啟動；請先登入你的帳號（或設定自動登入）。
- 登入後等約 30 秒（`ThrottleInterval`），用手機傳一則新訊息測試；有回覆就是接上了。
- plist 的 `PATH` 必須包含 Bun（`~/.bun/bin`）與 `claude` 所在資料夾，否則 telegram plugin 找不到 `bun`。
- 常駐用的工作資料夾必須**先手動開一次 Claude 並選擇「信任此資料夾」**，否則 launchd 帶起來的 session 會卡在信任提示。

### 2. 陷阱：session id 可能在長時間運作中換新，plist 寫死的舊 id 會過期

**實測現象**：launchd 帶起 `claude --resume <A>` 的 process 持續運作數天後，實際寫入的 session 檔已變成另一個 id `<B>`（`<B>.jsonl` 的第一筆事件就是後來收到的訊息，而 `<A>.jsonl` 停在很久以前）。推測與上下文重置／壓縮有關，**確切觸發條件我沒有確認**。

**後果**：重開機時 plist 仍寫著 `<A>`，就會回到 `<A>` 的舊狀態，看不到之後累積的工作與上下文。

**補充**：用 `--resume <B>` 重新啟動後，實測仍沿用同一個 id `<B>`（沒有再換）。所以「每次 resume 都會分叉新 id」這個說法**不成立**；重點是「id 會在運作期間某些時刻換新」，因此不要假設 plist 裡的 id 永遠是最新的。

**判斷方式**（唯讀）：

```bash
# 目前 launchd 那個 process 用的是哪個 id（開機時的 id）
ps -o pid,lstart,command -p $(launchctl print gui/$(id -u)/com.你的帳號.claude-telegram-channel | awk '/pid =/{print $3}')

# 專案資料夾裡，哪個 .jsonl 最近還在被寫入（＝目前對話的真正 id）
ls -lt ~/.claude/projects/-Users-你的帳號/*.jsonl | head -5
```

若最新被寫入的 `.jsonl` 檔名和 plist 裡的 id 不同，重開機後就會接錯對話。

### 3. 解法 A（最簡單）：重開機前把 plist 的 id 改成最新的

```bash
PLIST=~/Library/LaunchAgents/com.你的帳號.claude-telegram-channel.plist
cp "$PLIST" "$PLIST.bak"                                  # 先備份
/usr/libexec/PlistBuddy -c "Print :ProgramArguments" "$PLIST"   # 確認 --resume 後面的索引（通常是 :5）
/usr/libexec/PlistBuddy -c "Set :ProgramArguments:5 <最新的 session id>" "$PLIST"
plutil -lint "$PLIST"                                     # 語法檢查要回 OK
```

- 這只修改檔案，**不要**在對話還在進行時 `bootout`／`kickstart`（會中斷目前的 session）。重開機後 launchd 會自動讀新的 plist。
- 缺點：只要對話期間 id 又換新，**重開機前就要再檢查／更新一次**。

### 4. 解法 B（一勞永逸）：用啟動腳本自動接回「最新的 session」

見 `templates/start_telegram_channel.sh` 與 `templates/com.user.claude-telegram-channel.wrapper.plist`：

1. 把腳本複製到 `~/.claude/channels/telegram/start_telegram_channel.sh` 並 `chmod +x`。
2. plist 的 `ProgramArguments` 改成 `script -q /dev/null <腳本路徑>`（不用再寫 `--resume`）。
3. 腳本每次啟動時：找專案資料夾裡最近被寫入的 `.jsonl` → 用它的檔名當 session id → `exec claude --resume <id> --channels ... --dangerously-skip-permissions`。
4. 需要強制固定某個 session 時，建立 `~/.claude/channels/telegram/PINNED_SESSION`（內容放 id），腳本會優先使用它。
5. 改完 plist 後才需要 `bootout` 再 `bootstrap`（見第十一節）。

**注意**：如果你同時會在**同一個資料夾**開別的互動式 Claude session，「最新被寫入」可能不是 Telegram 那個；這種情況請用 `PINNED_SESSION` 固定，或讓 Telegram 用專屬工作資料夾。

### 5. 重開機前／後檢查清單

| 時機 | 動作 |
|------|------|
| 重開機前 | 確認最新的 session id（第 2 節）→ 解法 A 改 plist，或確認已採用解法 B |
| 重開機前 | 確認 plist 語法：`plutil -lint <plist>` |
| 重開機後 | 先登入使用者帳號，等約 30 秒 |
| 重開機後 | 手機傳「？」測試；沒回就 `launchctl print gui/$(id -u)/<label> \| grep -E "state\|pid\|last exit"` |
| 重開機後 | 進 `/mcp` 確認 Telegram 與其他連接器都是 connected；不是就選 Reconnect（見下節） |
| 重開機後 | Chrome 擴充（若使用 claude-in-chrome）需要 Chrome 已開啟並登入 |

---

## 十五、連接器（MCP）重連與「連錯工作區」問題（2026-09-21 新增）

### 1. 基本重連

在 Claude Code 輸入 `/mcp` → 選擇有問題的伺服器（例如 `claude.ai Notion`、`plugin:telegram:telegram`）→ **Reconnect / Authenticate**。成功會顯示 `Reconnected to ...`。

### 2. 症狀：讀得到 A 工作區、讀不到 B 工作區（Notion 為例）

- 用 API 讀 B 工作區的頁面，回 `object_not_found`（404），訊息提到「check that you have access and that you're authenticated to the correct workspace」。
- 用 Chrome 網頁版能正常打開該頁 → 代表**你的帳號有權限，但這個連接器授權在另一個工作區**（一個連接器授權綁定一個工作區）。
- 只按 `/mcp` 的 Reconnect **不一定會出現「選工作區」畫面**，重連後仍是舊工作區。
- 解法：到 claude.ai 的「設定 → 連接器」，把該連接器**中斷連線**後重新連線，在授權頁明確選擇目標工作區；回終端機 `/mcp` 再 Reconnect。
- 在對話中新增的授權，**目前這個 session 不一定會即時吃到**；不行就重開 session。
- 除錯順序：① 用網頁版確認頁面存在 → ② `notion-search` 搜該工作區的頁面標題 → ③ 搜不到＝連錯工作區。

---

## 十六、延伸：把 Telegram 當「入口」的自動化管線（2026-09-21 新增）

Telegram 已接上 Claude Code 之後，可以把「傳一個網址／檔案」當成觸發條件，讓 Claude 自動處理並回報。以下是實測可行的組合（全部可在自己的 Mac 上跑，不需要額外雲端服務）：

```
Telegram 傳網址 ─→ 判斷來源 ─→ 抓內容 ─→ 轉文字 ─→ 摘要分類 ─→ 寫入 Notion ─→ Telegram 回報連結與摘要
```

| 步驟 | 工具 | 備註 |
|------|------|------|
| 一般網頁 / GitHub / Threads | Claude 內建 WebFetch | 無法讀的登入頁改用 Chrome 擴充 |
| 影片（YouTube、小紅書、TikTok…） | `yt-dlp` | 小紅書短連結會被導到登入頁，需先取得**含 `xsec_token` 的完整網址**（`curl -s -o /dev/null -w '%{redirect_url}' <短連結>`）再丟給 yt-dlp |
| Instagram Reel | `instaloader`（免登入） | 產出 `-<shortcode>/` 資料夾（mp4、jpg、caption txt） |
| 語音轉文字 | `mlx-whisper`（Apple Silicon 本機） | 模型 `whisper-large-v3-turbo`；`--output-dir` 請指到**另一個資料夾**，避免蓋掉 caption 的同名 txt |
| 短影片名稱只在畫面上 | `ffmpeg -ss <秒> -frames:v 1` 截圖再讓 Claude 看圖 | 資訊圖表型短片口播常不念名稱 |
| 寫入 Notion | Notion MCP 連接器 | 見第十五節；欄位與資料庫 ID 寫進對應 skill |
| 回報 | telegram `reply` tool | 完成後另發一則新訊息（編輯訊息不會推播） |

**把流程寫成 skill**：在 `~/.claude/skills/<名稱>/SKILL.md` 寫下觸發條件、步驟與資料庫欄位規則，Claude 每次收到符合條件的訊息就會照做，不用每次重新說明。

**安裝位置提醒**：在系統 Python 3.9 上用 `pip3 install --user` 安裝的指令位於 `~/Library/Python/3.9/bin`，要加進 PATH 或用完整路徑；系統 Python 太舊時，`yt-dlp` 可能停在舊版而無法讀取新的 YouTube 頁面（錯誤如 `The page needs to be reloaded`），需要升級 Python 或改用其他來源。

**注意事項**
- 影片內容摘要要註明「已用逐字稿核對」或「未核對」；語音辨識常把英文名詞聽錯，需依上下文修正。
- 廣告／合作推廣、留言索取型（導流）內容要在備註標明。
- 暫存的影片與音檔處理完要刪除。

---

## 十七、2026-10 實戰修復紀錄：bot 沒回應的新原因與自動修復（2026-10-29 新增）

這一個月遇到的「Telegram 沒回應」，大部分都**不是**斷線：process 在跑、登入沒過期、log 也沒錯誤，但就是不回。以下照「症狀 → 原因 → 修法 → 自動化」整理。對應的腳本放在 `templates/watchdog/`、`templates/xhs_guard/`。

### 17-1 先分辨：bot 有沒有「收到」

在終端機設定 `ackReaction`，bot 一收到訊息就先按 👀：

```
/telegram:access set ackReaction 👀
```

| 手機上看到的 | 代表 | 往哪查 |
|---|---|---|
| 沒有 👀 | 訊息根本沒進到 bot | 17-2 搶線、第八／十二節的斷線排查 |
| 有 👀 但一直不回 | 連線正常，Claude 本身卡住 | 17-3 換模型選單、登入過期、被安全機制擋 |

### 17-2 被另一個 Claude 視窗「搶線」

**症狀**：完全沒回應。`launchctl print` 是 `running`，登入沒過期，舊 watchdog 也沒報警。

**原因**：在終端機開了另一個 `claude`（例如 `claude --chrome --resume`），那個互動視窗也載入了 telegram 外掛，起了自己的 `bun server.ts`，把 bot 的 long polling 搶走。launchd 那條底下就沒有 bun 了。舊 watchdog 只數「全機有幾個 bun」，數到的剛好是搶線的那個，所以沒發現。

**診斷**：

```bash
ps -eo pid,ppid,etime,command | grep -E "bun server.ts|channels plugin:telegram" | grep -v grep
```

看 `bun server.ts` 的上層是不是 launchd 那條 `claude --resume … --channels …`。上層是互動終端機的 `claude`，就是被搶線了。

**修法**：

```bash
pkill -f "bun server.ts"
launchctl kickstart -k gui/$(id -u)/com.YOUR_USERNAME.claude-telegram-channel
```

等 30 秒，傳一則訊息測試。

**自動化**：`templates/watchdog/check_and_reconnect.sh` 每 2 分鐘檢查一次，只承認「launchd job pid 的子孫」裡的 bun。其他來源的 bun 一律關掉；launchd 那條沒有 bun 就 `kickstart -k`，並用 Bot API 通知使用者（一小時最多一次）。

**教訓**
- 關 process 要看**執行檔名稱**（`ps -o comm=`），不要看指令文字。測試時，一個指令文字裡剛好含 `bun server.ts` 的 shell 就被誤關了。
- 在終端機工作時要傳 TG，**直接呼叫 Bot API `sendMessage`**，不要在終端機載入 telegram 外掛：

```bash
curl -s "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${CHAT_ID}" --data-urlencode "text=訊息內容"
```

### 17-3 卡在「要不要換模型」選單

**症狀**：有 👀，但之後每則都不回，可以一直卡好幾個小時。

**原因**：某則回覆被模型的安全機制擋下（不一定是真的有問題，偶爾會誤判），Claude Code 在 bot 的終端畫面跳出「Model switch … Switch to 另一個模型?」選單等人選。bot 跑在 launchd 背景，沒人看得到這個畫面。這種卡法也**不會寫成 transcript 裡的錯誤**，所以 17-5 的錯誤偵測抓不到。

**診斷**：看 launchd 的畫面輸出（去掉控制碼）：

```bash
tail -c 3000 ~/.claude/channels/telegram/launchd.out.log \
  | LC_ALL=C sed 's/\x1b\[[0-9;?]*[A-Za-z]//g' | strings | tail -15
```

看到 `Model switch`、`safeguards flagged this session` 就是這個。

**修法**
- 用原模型 `kickstart -k` **沒用**：`--resume` 之後會馬上又跳出同一個選單。
- 要把 plist 的 `--model` 改成選單建議的模型，再 `bootout` ＋ `bootstrap`。改之前先確認那個模型可以用：

```bash
claude -p --model <選單建議的模型> --no-session-persistence "只回覆 OK"
```

**自動化**：`templates/watchdog/model_switch_guard.py`（由 `check_and_reconnect.sh` 呼叫）
1. 在 `launchd.out.log` 的新內容裡看到選單 → 用 TG 通知使用者（人在電腦前可以自己選）。
2. 2 分鐘後 transcript 裡還是沒有 bot 的新回覆 → 自動改 `--model`、重新載入，再通知使用者重傳訊息。
3. 處理過後 30 分鐘內不再動作，避免重啟循環。

**注意**
- bot 卡住時收不到 TG，所以**沒辦法用 TG 回答這個選單**，只能在電腦前選，或等它自動處理。
- 判斷「卡住」不能只看 transcript 的修改時間：卡住時進來的訊息一樣會寫進 transcript。要看有沒有 **assistant** 的新內容。
- 換模型後 bot 會長期停在新模型，要換回來就把 `--model` 改回去，但同一個 session 可能又被擋。

### 17-4 群組裡「網頁可以、影片不行」

群組的安全紅線（第十節）是「群組訊息可以讀、可以回，但**不能執行本機程式**」，避免群組裡任何人都能透過 bot 操作你的電腦。實際效果：

| 在群組 tag bot 傳的內容 | 結果 | 原因 |
|---|---|---|
| 新聞、文章、一般網頁 | ✅ 可以分析 | 用內建 WebFetch 讀網頁，不用跑本機程式 |
| IG、小紅書、YouTube 影片 | ❌ 不處理 | 要在本機跑下載和轉文字的程式 |

這條規則**不分是誰傳的**，連 bot 主人自己在群組傳也一樣。要分析影片就把連結轉傳到私訊。如果想放行，可以改成「只有主人的 Telegram 帳號 ID 才能在群組觸發影片流程」，但要自己評估風險。

### 17-5 登入過期、被安全機制擋（10-16 ～ 10-20）

這部分的完整排查和 `auto_repair.py` 說明在 [claude-telegram-bridge](https://github.com/Allison82/claude-telegram-bridge) 的 `docs/TROUBLESHOOTING_LOG.md`。重點：
- **`Login expired`** 只會出現在 `launchd.out.log` 的畫面裡，不在 `err.log`。修法是在任一個互動視窗 `/login`，再 `kickstart -k`。
- **每則訊息都被擋**（`can't help with this. Start a new session`）：先用 `--fork-session` 測試換模型能不能過（保留記憶），全部失敗才換新 session。
- `auto_repair.py` 讀的是 transcript 裡結構化的 API 錯誤列，不看畫面，因為 `--resume` 重開時畫面會把舊錯誤重畫一遍，看畫面會誤判。

### 17-6 小紅書改成要登入才能看（2026-10-24 起）

**症狀**：第十六節的 `yt-dlp` 流程開始失敗，被導去登入頁。小紅書單篇內容現在要登入才看得到。

**做法：給 bot 一個「專用登入」**
- 用 Firefox 開一個**獨立的設定檔資料夾**只登小紅書，`yt-dlp` 從這個資料夾讀 cookies：

```bash
FP="$HOME/.claude/channels/telegram/xhs_guard/profile"
yt-dlp --cookies-from-browser "firefox:$FP" -f b --write-info-json -o v.mp4 "<含 xsec_token 的完整網址>"
```

- **不要用 Chrome 的 cookies**（裡面有 Google、網銀等登入），也不要跟自己平常瀏覽的設定檔混用（自動化工具 puppeteer 會改掉瀏覽器的安全設定）。
- **圖文筆記**（轉址網址是 `type=normal`）yt-dlp 會失敗，改抓網頁 HTML，解析 `window.__INITIAL_STATE__` 裡的 `note.noteDetailMap`。要用 Node 解析，不要用 Python `json.loads`：裡面有 `undefined`，會解析失敗。圖片下載要帶 `Referer: https://www.xiaohongshu.com/`。
- 短連結展開要用 GET：`curl -s -o /dev/null -w "%{redirect_url}" <短連結>`，`curl -I` 會回 404。

**登入過期自動處理**：`templates/xhs_guard/`
- `xhs_guard.js status`：印出 `logged_in`／`logged_out`。判斷方式是帶 cookies 抓首頁，看有沒有 `"loggedIn":true`。
- `xhs_guard.js check`：由 launchd 每天跑（`com.user.xhs-guard.plist`）。還登入著就開一次首頁保持登入；登出了就走 `login`。
- `xhs_guard.js login`：傳 TG 提醒「回電腦點兩下桌面『小紅書機器人登入』，用手機 App 掃螢幕上的 QR code」，然後在背景每 30 秒檢查一次，最多 3 小時，登入成功就自動通知。
- `xhs_guard.js qr`（備用）：把 QR code 截圖傳到 TG。**實測手機 App 不一定能從相簿掃**，只在旁邊有另一台裝置能顯示 QR code 時才用。

**踩過的坑**
- 背景等待的迴圈裡，網路一時不通會讓 `fetch` 丟例外，整個等待流程直接結束，登入成功也不會通知。檢查登入的函式要自己接住錯誤、當成「這輪還沒登入」。
- 桌面上兩個長得很像的捷徑（自己瀏覽用的、bot 登入用的）很容易點錯，**登在自己的瀏覽器裡 bot 一樣讀不到**。分辨方法：bot 的視窗打開就是登出狀態、直接跳 QR code。
- 不要在背景監看指令的文字裡放 `xhs_guard.js login` 這串字：bot 用 `pkill -f` 關舊流程時會連監看指令一起關掉。

### 17-7 Google 地圖收藏清單：沒辦法自動加入

**需求**：傳 Google 地圖店家網址，bot 把店加進自己的地圖收藏清單（例如「想去吃的店」）。

**結論：目前沒辦法可靠地自動完成。**

| 可能原因 | 實測結果 |
|---|---|
| 有沒有寫入清單的 API | **沒有**。Places API 只能查店家，不能把店加進私人收藏清單。存進 Google 試算表不等於存進地圖 |
| 瀏覽器沒登入／帳號錯 | 不是：儲存選單能正常列出自己的清單和地點數 |
| 清單沒有編輯權限 | 不是：清單是自己建的，第一次有成功過 |
| **自動點擊沒生效** | **是**：用元素參照點、用螢幕座標點「儲存」，選單都不出現；清單頁的「新增地點」搜尋框也叫不出來 |

**最後採用的流程**
1. 展開網址，確認店名和地址。不只一家（同品牌多分店）就先列候選問使用者，不要猜。
2. 回傳店名、地址、評分和店家連結，請使用者在手機上點「儲存」→ 勾清單，兩下就好。
3. **不要回報「已加入」**，除非重新打開清單頁確認地點數增加、店名也出現了。

---

*建立日期：2026-05-16*
*最後更新：2026-10-29（新增第十七節：搶線、換模型選單卡住、群組限制、小紅書專用登入、Google 地圖清單限制，與對應的自動修復腳本）*
*前次更新：2026-09-21（重開機自動接回同一個對話與 session id 會換新的陷阱、啟動腳本模板、連接器重連與連錯工作區、Telegram 入口自動化管線）*
*適用版本：telegram plugin v0.0.6/v0.0.7，Claude Code CLI*
