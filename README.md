# Claude Code × Telegram 串接系統

讓你在任何地方用手機 Telegram 操控跑在自己電腦上的 Claude Code。

## 架構總覽

```
[你的手機 Telegram]
      │  傳訊息
      ▼
[@TGIF_claude_bot（Telegram Bot API）]
      │  long polling（從雲端拉訊息）
      ▼
[bun server.ts（MCP plugin，跑在你電腦上）]
      │  stdio MCP 協定
      ▼
[Claude Code（--channels 旗標啟動）]
      │  用 reply tool 回覆
      ▼
[bun server.ts → Telegram Bot API → 手機 push notification]
```

## 檔案說明

| 檔案 | 說明 |
|------|------|
| `Claude_Telegram_Setup.md` | 完整安裝教學（中文），含 launchd 常駐、排查 SOP |
| `AI_Handoff_Telegram.md` | 給下一位 AI 的交接文件：換 bot、此次故障根因、驗證與修復 SOP |
| `templates/access.json` | access.json 模板，填入你的 chat_id 即可用 |
| `templates/com.user.claude-telegram-channel.plist` | launchd plist 模板，填入路徑和 session id |
| `templates/CLAUDE.md` | CLAUDE.md 範本，告訴 Claude 用 Telegram 溝通 |
| `templates/start_telegram_channel.sh` | 啟動腳本：每次自動接回**最新的 session**（解決 `--resume` id 分叉、重開機接錯對話） |
| `templates/com.user.claude-telegram-channel.wrapper.plist` | 搭配上面腳本的 launchd plist（進階版） |

## 快速開始

1. 閱讀 `Claude_Telegram_Setup.md` 完整走一遍
2. 用 `templates/` 裡的模板建立設定檔
3. 用 launchd 讓 Claude Code 24 小時常駐（見文件第十一節）
4. 換 bot 或排查失敗時，先閱讀 `AI_Handoff_Telegram.md`
5. **要重開機、又想繼續同一個對話**：讀 `Claude_Telegram_Setup.md` 第十四節（`--resume` 每次會分叉新 session id，plist 寫死舊 id 會接回舊對話）
6. 連接器（Notion 等）讀不到資料：讀第十五節（可能連錯工作區）
7. 想把 Telegram 當入口做自動化（傳網址 → 抓內容 → 轉文字 → 寫入 Notion）：讀第十六節

## 相容性

- macOS（zsh）
- Claude Code CLI
- telegram plugin v0.0.6 / v0.0.7
- Bun runtime

---
*詳細說明見 Claude_Telegram_Setup.md*
