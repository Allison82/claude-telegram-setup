# 給下一位 AI：Telegram Channel 交接與換 Bot SOP

> 目的：下一次要串接新的 Telegram bot，或出現「手機傳訊息沒有回覆」時，依本文件診斷與修復。
> 安全規則：**絕不在終端輸出、repo、log 或對話中貼出 bot token。** 只檢查檔案是否存在、key 是否存在、token 長度，或呼叫 Telegram `getMe` 顯示 bot username。

## 先理解架構

```
手機 Telegram → Telegram Bot API → telegram plugin 的 Bun server
                                     ↕ stdio MCP
                                Claude Code --channels → reply tool → Telegram
```

同一個 bot token 只能有**一個** long-polling consumer。launchd 常駐服務與手動 `claude --channels` 同時存在時，會互搶更新，造成訊息偶爾消失或 `409 Conflict`。

## A. 換一個新的 Telegram Bot

1. 用 @BotFather 建 bot，保管好新 token。
2. 在已有 plugin 的 Claude Code session 執行（不要把 token 放進 git）：

   ```text
   /telegram:configure <新 token>
   ```

   此指令會寫入 `~/.claude/channels/telegram/.env`。
3. 讓自己的 Telegram numeric user ID 位於 `~/.claude/channels/telegram/access.json`：

   ```json
   {
     "dmPolicy": "allowlist",
     "allowFrom": ["你的 Telegram user ID"],
     "groups": {},
     "pending": {}
   }
   ```

   `allowFrom` 必須是**字串陣列**，不是數字，也不是 `allowlist` 欄位。
4. 確保只保留一個 Claude Channel process。正式環境用 launchd；若只做測試，先停止 launchd 再手動啟動。
5. 用以下指令啟動：

   ```bash
   claude --channels plugin:telegram@claude-plugins-official --dangerously-skip-permissions
   ```

6. 在 Claude 裡輸入 `/mcp`。只有看到 `plugin:telegram:telegram · connected` 才算完成；`failed` 不能靠手機重傳解決。
7. 從手機傳新訊息，確認 Claude 真的回覆，再切回 `dmPolicy: allowlist`（若曾為 pairing）。

## B. 本次事故（2026-09-01）與已驗證根因

### 症狀

- 單獨執行 plugin 內的 `bun server.ts` 能收到 Telegram 訊息。
- 以 `claude --channels plugin:telegram@claude-plugins-official` 啟動時，`/mcp` 顯示 `plugin:telegram:telegram · failed`。
- 手機訊息沒有回覆。

### 根因鏈

1. Claude plugin 的 `.mcp.json` 以裸 `bun` 指令啟動；某些舊終端或 GUI / launchd 環境的 `PATH` 不含 `~/.bun/bin`。
2. 官方 v0.0.7 plugin 的 `start` script 每次先執行 `bun install`。快取目錄沒有 `node_modules` 時，啟動會失敗；受限環境也可能無法寫入 Bun temp directory。
3. server 啟動時會對 `~/.claude/channels/telegram/.env` 執行 `chmod 600`。若該檔案或資料夾不能寫，程式 catch 後跳過整段讀取，最後顯示 `TELEGRAM_BOT_TOKEN required`，即使 token 明明存在。

### 已驗證的診斷指令（不洩漏 token）

```bash
# Bun 與 Claude 是否可被目前 shell 找到
command -v bun && bun --version
command -v claude && claude --version

# 設定檔與 access policy 是否存在（不印 token）
test -f ~/.claude/channels/telegram/.env && echo 'token config exists'
awk -F= '/^TELEGRAM_BOT_TOKEN=/{print "token key present; length=" length($2)}' ~/.claude/channels/telegram/.env
cat ~/.claude/channels/telegram/access.json

# 目前是否有重複 consumer（在一般 macOS Terminal 執行）
ps -ef | grep -E 'claude --channels|claude --resume|bun (run|server.ts)' | grep -v grep
```

### 修復順序

1. 先停止所有重複的 Claude / Bun channel process；若正式用 launchd，依主文件用 `launchctl bootout` 或 `kickstart -k`，不要直接 kill 後又手動開一份。
2. 修正「啟動 Claude 的環境」而不是只修互動 shell：launchd plist 必須有 Bun 路徑，例如 `PATH=/Users/<帳號>/.bun/bin:/usr/local/bin:/usr/bin:/bin`。在 plist 中設定 `EnvironmentVariables` 後，必須 bootout 再 bootstrap 才會載入新設定。
3. 進 plugin 的實際版本目錄執行一次 `bun install`，確認存在 `node_modules`：

   ```bash
   cd ~/.claude/plugins/cache/claude-plugins-official/telegram/<版本>
   bun install
   ```

4. 確認 token 檔案可供 owner 讀寫並維持私密權限：

   ```bash
   chmod 600 ~/.claude/channels/telegram/.env
   ```

5. 重啟 Claude Channel，打開 `/mcp` 確認 `connected` 後才測手機。

## C. 不要把暫時修正當成永久設定

曾為了立即排錯而直接修改以下 cache 檔：

- `~/.claude/plugins/cache/.../telegram/<版本>/.mcp.json`
- `~/.claude/plugins/cache/.../telegram/<版本>/package.json`

這些變更會隨 plugin 更新或重新安裝被覆蓋。永久解法是：在啟動 Claude 的終端設定或 launchd plist 設定正確的 PATH，並讓 plugin 在其快取目錄順利執行一次 `bun install`。

## D. macOS 自動啟動：本次實作（2026-09-16）

### 直接原因

Mac 登入後沒有已載入的 Telegram LaunchAgent；原本留下的 `bot.pid` 也指向不存在的 process。因此 bot token 雖有效，卻沒有人在 long polling。

### 容易漏掉的兩個細節

1. **launchd 沒有互動式 TTY**。直接執行 `claude --channels ...` 時，Claude 可能自動切到 print 模式並退出，log 會出現：`Input must be provided either through stdin or as a prompt argument when using --print`。
2. **工作資料夾必須已被 Claude 信任**。否則常駐服務會卡在「Yes, I trust this folder」提示，永遠無法開始 channel polling。

### 可用的 LaunchAgent 設計

使用一個隔離且已信任的 workspace，例如：

```text
~/.openclaw/workspace/skills/claude-telegram-channel
```

不要把 Telegram 的無人值守 session 指向薪資、帳務或其他敏感專案。先在該資料夾手動開一次 Claude，選擇信任後再交給 launchd。

plist 的核心是以 `/usr/bin/script -q /dev/null` 提供 pseudo-TTY，並指定完整 PATH：

```xml
<array>
  <string>/usr/bin/script</string>
  <string>-q</string>
  <string>/dev/null</string>
  <string>/Users/你的帳號/.local/bin/claude</string>
  <string>--channels</string>
  <string>plugin:telegram@claude-plugins-official</string>
  <string>--dangerously-skip-permissions</string>
</array>
<key>EnvironmentVariables</key>
<dict>
  <key>PATH</key>
  <string>/Users/你的帳號/.bun/bin:/Users/你的帳號/.local/bin:/usr/local/bin:/usr/bin:/bin</string>
</dict>
```

再加上 `RunAtLoad`、`KeepAlive` 與 `ThrottleInterval`，使它在登入後啟動、崩潰後重試。

### 驗證

```bash
launchctl print gui/$(id -u)/com.你的帳號.claude-telegram-channel
tail -n 100 ~/.claude/channels/telegram/launchd.out.log
tail -n 100 ~/.claude/channels/telegram/launchd.err.log
```

成功時 launchctl 顯示 `state = running`；stdout 可看到 Channels 已由 `plugin:telegram@claude-plugins-official` 注入 session。最後以 Telegram Bot API 的 `sendMessage` 或手機實際傳送新訊息測試。

## E. 完成定義

以下四項都成立才宣告打通：

1. `/mcp` 顯示 Telegram plugin `connected`，不是 `failed`。
2. Telegram `getMe` 回傳預期的新 bot username（只在本機執行，勿貼 token）。
3. `access.json` 包含自己的 user ID。
4. 手機傳一則全新的測試訊息，收到 Claude 實際回覆。
