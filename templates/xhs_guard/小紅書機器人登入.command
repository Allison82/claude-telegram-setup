#!/bin/zsh
# 桌面捷徑：開啟 Telegram 機器人專用的小紅書登入視窗（跟自己平常看小紅書的瀏覽器分開）
# 用手機小紅書 App「掃一掃」掃螢幕上的 QR code，登入後關掉視窗就好
P="$HOME/.claude/channels/telegram/xhs_guard/profile"
if pgrep -f -- "--profile $P" >/dev/null; then
  osascript -e 'display notification "機器人登入視窗已經開著了" with title "小紅書"'
else
  open -na Firefox --args --no-remote --profile "$P" "https://www.xiaohongshu.com/explore"
fi
