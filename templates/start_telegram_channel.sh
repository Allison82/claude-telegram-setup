#!/bin/zsh
# 啟動 Claude Code 的 Telegram channel，並「接回最新的 session」。
#
# 為什麼需要它：實測 launchd 常駐的 Claude 運作數天後，實際寫入的 session 檔可能已換成
# 另一個 id（舊 id 的 .jsonl 停在很久以前）。如果 plist 永遠寫死同一個舊 id，
# 重開機後就會回到「很久以前」的對話狀態。
# 這支腳本每次啟動時自動挑選最近被寫入的 session 接回，就不用手動更新 plist。
#
# 用法：把 launchd plist 的 ProgramArguments 改成
#   /usr/bin/script -q /dev/null /YOUR_HOME/.claude/channels/telegram/start_telegram_channel.sh
# （仍需 script 提供 pseudo-TTY，見 Claude_Telegram_Setup.md 第十四節）
#
# 覆寫機制：若存在 ~/.claude/channels/telegram/PINNED_SESSION（內容是一個 session id），
# 就強制接回該 id，不自動挑最新。適合「我同時也會在同一個資料夾開別的互動式 session」的情況。

set -u

export PATH="$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
CLAUDE_BIN="${CLAUDE_BIN:-$HOME/.local/bin/claude}"
WORKDIR="${WORKDIR:-$HOME}"
cd "$WORKDIR" || exit 1

# Claude 依「工作目錄路徑」把 session 存在 ~/.claude/projects/<路徑中的 / 與 . 換成 ->/
ENCODED="$(printf '%s' "$PWD" | sed 's#[/.]#-#g')"
PROJECT_DIR="$HOME/.claude/projects/$ENCODED"
PIN_FILE="$HOME/.claude/channels/telegram/PINNED_SESSION"

SID=""
if [ -s "$PIN_FILE" ]; then
  SID="$(tr -d '[:space:]' < "$PIN_FILE")"
else
  # 最近被寫入的 .jsonl 檔名 = session id
  LATEST="$(ls -t "$PROJECT_DIR"/*.jsonl 2>/dev/null | head -1)"
  [ -n "$LATEST" ] && SID="$(basename "$LATEST" .jsonl)"
fi

echo "[start_telegram_channel] $(date '+%F %T') workdir=$PWD session=${SID:-<none, start fresh>}"

if [ -n "$SID" ]; then
  exec "$CLAUDE_BIN" --resume "$SID" \
    --channels plugin:telegram@claude-plugins-official \
    --dangerously-skip-permissions
else
  exec "$CLAUDE_BIN" \
    --channels plugin:telegram@claude-plugins-official \
    --dangerously-skip-permissions
fi
