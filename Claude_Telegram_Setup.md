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

找 [@userinfobot](https://t.me/userinfobot) 傳任意訊息，他會回你的 numeric ID（例：`7787335190`）。

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

範例（chat_id 為 7787335190）：
```json
{
  "dmPolicy": "allowlist",
  "allowFrom": ["7787335190"],
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
| Label | `com.genelin325gmail.claude-telegram-channel` |
| Plist 路徑 | `~/Library/LaunchAgents/com.genelin325gmail.claude-telegram-channel.plist` |
| 啟動方式 | `RunAtLoad`（開機/登入自動啟動）+ `KeepAlive`（掛掉 30 秒內自動復活） |
| 固定參數 | `claude --resume <sessionId> --channels plugin:telegram@claude-plugins-official --dangerously-skip-permissions` |
| stdout log | `~/.claude/channels/telegram/launchd.out.log`（完整終端機畫面截取，會一直長大，用 `tail` 看尾巴就好，不要整份 cat） |
| stderr log | `~/.claude/channels/telegram/launchd.err.log` |

**常用 launchctl 指令：**

```bash
# 看目前狀態（state 應為 running，記下 pid）
launchctl print gui/$(id -u)/com.genelin325gmail.claude-telegram-channel

# 原地重啟（憑證過期 / 卡住，但 plist 內容沒改）
launchctl kickstart -k gui/$(id -u)/com.genelin325gmail.claude-telegram-channel

# plist 內容改了（例如要換 --resume 成另一個 session id）才需要這組，
# 單純 kickstart 不會吃到新的 plist 內容
launchctl bootout gui/$(id -u)/com.genelin325gmail.claude-telegram-channel
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.genelin325gmail.claude-telegram-channel.plist
```

**絕對不要用 `kill` 期待它從此消失** — `KeepAlive` 會在 30 秒內用舊 plist/舊狀態把它救回來，跟你正在修的東西打架。要嘛用 `kickstart -k`（原地重開），要嘛先 `bootout` 再 `bootstrap`。

---

## 十二、實戰排查 SOP（2026-08-23 打通紀錄）

**症狀**：使用者回報「Telegram 傳訊息沒反應 / 沒收到回覆」。

### Step 1：診斷（唯讀，一次全部跑，不要先動手）

```bash
# 1. launchd 狀態
launchctl print gui/$(id -u)/com.genelin325gmail.claude-telegram-channel | grep -E "state|pid|last exit"

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
   launchctl kickstart -k gui/$(id -u)/com.genelin325gmail.claude-telegram-channel
   ```
   讓正牌 process 重開、從硬碟重新讀取新憑證。
3. 等 5–10 秒，重跑 Step 1 全部診斷，確認：`state=running`、只剩一條 chain、error log 沒有新的 401。

### Step 4：驗證真的打通（不能只信 log，要真人測）

```bash
# 主動推播一則自檢訊息，先確認「bot → 人」這個方向沒問題
TOKEN=$(grep -o 'TELEGRAM_BOT_TOKEN=.*' ~/.claude/channels/telegram/.env | cut -d= -f2)
curl -s "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  -d chat_id=7787335190 \
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
| 看 launchd 狀態 | `launchctl print gui/$(id -u)/com.genelin325gmail.claude-telegram-channel` |
| 找重複/殭屍 process | `ps -ef \| grep -E "claude --resume\|claude --channels\|bun (run\|server.ts)" \| grep -v grep` |
| 看正牌 process 的畫面/log | `tail -c 4000 ~/.claude/channels/telegram/launchd.out.log`、`tail -80 ~/.claude/channels/telegram/launchd.err.log` |
| 驗證 token/bot 身份 | `curl -s "https://api.telegram.org/bot<TOKEN>/getMe"` |
| 驗證沒有 webhook 卡住 | `curl -s "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"` |
| 主動推播測試訊息 | `curl -s "https://api.telegram.org/bot<TOKEN>/sendMessage" -d chat_id=<id> -d text="..."` |
| 原地重啟正牌 process（憑證過期/卡住） | `launchctl kickstart -k gui/$(id -u)/com.genelin325gmail.claude-telegram-channel` |
| plist 內容改了要重載 | `launchctl bootout ...` 後 `launchctl bootstrap ...`（見第十一節） |
| 殺掉非 launchd 帶起的重複 bot | `kill -TERM <pid>`（先用上面 ps 確認 parent 不是 launchd） |

**這幾個事故本次都遇過，下次看到一樣症狀直接照這張表走：**
- 「傳訊息沒反應」→ 先懷疑「多條重複 process 在搶 + 正牌那條 401」，Step 1 全跑一遍就知道。
- 也可以直接用 `telegram-healthcheck` skill，內容跟這節同步，會自動跑完整套 SOP。

---

*建立日期：2026-05-16*
*最後更新：2026-08-23（新增 launchd 常駐架構、重複 process 排查 SOP）*
*適用版本：telegram plugin v0.0.6/v0.0.7，Claude Code CLI*
