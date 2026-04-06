#!/bin/bash
# Regenerate groups/telegram_main/CLAUDE.md from groups/main/CLAUDE.md
# Run automatically via git post-commit hook whenever groups/main/CLAUDE.md changes.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_DIR/groups/main/CLAUDE.md"
DST="$REPO_DIR/groups/telegram_main/CLAUDE.md"

if [[ ! -f "$SRC" ]]; then
  echo "sync-telegram-claude-md: $SRC not found, skipping" >&2
  exit 0
fi

sed \
  -e 's/source_channel: nanoclaw/source_channel: telegram/' \
  -e 's|groups/main/|groups/telegram_main/|' \
  -e 's/# The Dude — WhatsApp/# The Dude — Telegram/' \
  -e 's/You are The Dude, a personal assistant for Noam on WhatsApp./You are The Dude, a personal assistant for Noam on Telegram./' \
  -e 's/Format using WhatsApp style/Format using Telegram style/' \
  "$SRC" > "$DST"

echo "sync-telegram-claude-md: regenerated $DST from $SRC"
