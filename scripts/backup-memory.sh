#!/bin/bash
# Backup all memory/preference files across groups with versioning.
# Before backing up, runs an AI integrity check comparing current files
# against the last backup. If corruption is detected, notifies via Telegram
# and skips the backup to prevent corrupted data from entering the backup chain.
#
# Retains the last 30 snapshots (~1 month at daily frequency).
#
# Usage: Run via system cron (independent of NanoClaw process).
#   crontab -e → 0 3 * * * /home/nanoclaw/NanoClaw/scripts/backup-memory.sh

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GROUPS_DIR="$PROJECT_ROOT/groups"
BACKUP_ROOT="$PROJECT_ROOT/data/memory-backups"
MAX_SNAPSHOTS=30
LOG_FILE="$PROJECT_ROOT/logs/backup.log"
TOKEN_CACHE="$PROJECT_ROOT/data/.onecli-token-cache"

# Notification config
source "$PROJECT_ROOT/.env"
TELEGRAM_CHAT_ID="145958767"

# Hardcoded fallback token (last known working value)
FALLBACK_TOKEN="aoc_87445a1dc602e369118eb53e8163d6acefb2b01a9b76c6c5c2e2cbab4edb5869"
ONECLI_CA="/tmp/onecli-proxy-ca.pem"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG_FILE"
}

send_telegram() {
  local msg="$1"
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="$TELEGRAM_CHAT_ID" \
    -d text="$msg" \
    -d parse_mode="Markdown" > /dev/null 2>&1
}

# Resolve OneCLI agent access token: dynamic lookup → cache → hardcoded fallback.
# Updates the cache on success so the next run has a fresh fallback.
resolve_onecli_token() {
  local token=""

  # 1. Try dynamic lookup via onecli CLI
  if command -v onecli &>/dev/null; then
    token=$(onecli agents list 2>/dev/null | python3 -c "
import sys, json
try:
    agents = json.load(sys.stdin)
    default = next((a for a in agents if a.get('isDefault')), agents[0] if agents else None)
    print(default['accessToken'] if default else '')
except Exception:
    pass
" 2>/dev/null)
    if [ -n "$token" ]; then
      log "OneCLI token: resolved dynamically"
      echo "$token" > "$TOKEN_CACHE"
      echo "$token"
      return 0
    fi
    log "OneCLI token: dynamic lookup failed"
  else
    log "OneCLI token: onecli CLI not found"
  fi

  # 2. Try cached token from last successful dynamic lookup
  if [ -f "$TOKEN_CACHE" ]; then
    token=$(cat "$TOKEN_CACHE" 2>/dev/null)
    if [ -n "$token" ]; then
      log "OneCLI token: using cached value"
      echo "$token"
      return 0
    fi
  fi

  # 3. Hardcoded fallback
  log "OneCLI token: using hardcoded fallback"
  echo "$FALLBACK_TOKEN"
}

# Test that the resolved token actually works against the proxy
test_proxy_connection() {
  local token="$1"
  local proxy="http://x:${token}@localhost:10255"

  local result
  result=$(curl -s --max-time 5 --proxy "$proxy" --cacert "$ONECLI_CA" \
    -X POST "https://api.anthropic.com/v1/messages" \
    -H "Content-Type: application/json" \
    -H "x-api-key: placeholder" \
    -H "anthropic-version: 2023-06-01" \
    -d '{"model":"claude-haiku-4-5-20251001","max_tokens":5,"messages":[{"role":"user","content":"ok"}]}' 2>/dev/null)

  echo "$result" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if data.get('type') == 'message':
        print('OK')
    else:
        print(data.get('error',{}).get('type','UNKNOWN_ERROR'))
except Exception:
    print('PARSE_ERROR')
" 2>/dev/null
}

# Find the most recent backup snapshot
get_last_backup() {
  find "$BACKUP_ROOT" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort | tail -1
}

# Build a summary of current memory files for the AI check
build_current_snapshot() {
  local output=""
  for f in $(find "$GROUPS_DIR" -maxdepth 3 \( -name '*.md' \) -type f | sort); do
    local rel="${f#$GROUPS_DIR/}"
    local size=$(wc -c < "$f")
    local lines=$(wc -l < "$f")
    output+="--- FILE: $rel (${size}B, ${lines} lines) ---"$'\n'
    output+="$(cat "$f")"$'\n'$'\n'
  done
  echo "$output"
}

# Build a summary of the last backup for comparison
build_backup_snapshot() {
  local backup_dir="$1"
  local output=""
  for f in $(find "$backup_dir" -maxdepth 3 -name '*.md' -type f | sort); do
    local rel="${f#$backup_dir/}"
    local size=$(wc -c < "$f")
    local lines=$(wc -l < "$f")
    output+="--- FILE: $rel (${size}B, ${lines} lines) ---"$'\n'
    output+="$(cat "$f")"$'\n'$'\n'
  done
  echo "$output"
}

# Run AI integrity check comparing current files to last backup
run_ai_check() {
  local current="$1"
  local previous="$2"
  local proxy="$3"

  local prompt="You are a memory file integrity checker for a personal AI assistant called The Dude. Compare the CURRENT memory files against the PREVIOUS backup and check for corruption or unwanted changes.

Signs of corruption or problems:
- Key sections completely wiped or replaced with unrelated content
- Preferences contradicting themselves (e.g. a rule saying 'always guess' when the previous version said 'never guess')
- Files drastically shorter with important content missing (not just reformatted)
- Garbled text, encoding issues, or nonsense content
- Identity information changed (name, email, contact info altered)
- Communication style rules reversed or removed without apparent reason

NOT corruption (normal changes):
- New preferences added
- Wording refined while keeping the same meaning
- Files reorganized or restructured
- New files added
- Minor formatting changes

Respond with EXACTLY one line:
- If everything looks fine: OK
- If something looks wrong: ALERT: [brief description of the issue]

PREVIOUS BACKUP:
$previous

CURRENT FILES:
$current"

  local response
  response=$(curl -s --proxy "$proxy" --cacert "$ONECLI_CA" \
    -X POST "https://api.anthropic.com/v1/messages" \
    -H "Content-Type: application/json" \
    -H "x-api-key: placeholder" \
    -H "anthropic-version: 2023-06-01" \
    -d "$(python3 -c "
import json, sys
prompt = sys.stdin.read()
print(json.dumps({
    'model': 'claude-haiku-4-5-20251001',
    'max_tokens': 200,
    'messages': [{'role': 'user', 'content': prompt}]
}))
" <<< "$prompt")" 2>/dev/null)

  # Extract the text from the response
  echo "$response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data['content'][0]['text'])
except Exception:
    print('ERROR: Failed to parse AI response')
" 2>/dev/null
}

# --- Main ---

mkdir -p "$BACKUP_ROOT" "$(dirname "$LOG_FILE")" "$(dirname "$TOKEN_CACHE")"
log "Starting memory backup"

# Resolve OneCLI token (dynamic → cache → fallback)
ONECLI_TOKEN=$(resolve_onecli_token)
ONECLI_PROXY="http://x:${ONECLI_TOKEN}@localhost:10255"

# Verify the token works
PROXY_STATUS=$(test_proxy_connection "$ONECLI_TOKEN")
if [ "$PROXY_STATUS" != "OK" ]; then
  log "Primary token failed ($PROXY_STATUS), trying fallback"

  # If dynamic token failed, try the hardcoded fallback directly
  if [ "$ONECLI_TOKEN" != "$FALLBACK_TOKEN" ]; then
    PROXY_STATUS=$(test_proxy_connection "$FALLBACK_TOKEN")
    if [ "$PROXY_STATUS" = "OK" ]; then
      log "Fallback token works"
      ONECLI_TOKEN="$FALLBACK_TOKEN"
      ONECLI_PROXY="http://x:${ONECLI_TOKEN}@localhost:10255"
    fi
  fi

  # If nothing works, notify and mark AI check as unavailable
  if [ "$PROXY_STATUS" != "OK" ]; then
    log "All OneCLI tokens failed — AI check unavailable"
    send_telegram "⚠️ *Memory Backup — API Access Issue*

The backup script cannot reach the Anthropic API through the OneCLI proxy. The AI integrity check will fall back to heuristics only.

*Error:* \`$PROXY_STATUS\`

*To fix, tell Claude Code:*
\`\`\`
The memory backup script at scripts/backup-memory.sh can't authenticate to the OneCLI proxy. The agent access token may have been regenerated. Run 'onecli agents list' to get the current default agent accessToken, then update the FALLBACK_TOKEN in the script and delete data/.onecli-token-cache so it re-caches.
\`\`\`"
    AI_AVAILABLE=false
  else
    AI_AVAILABLE=true
  fi
else
  AI_AVAILABLE=true
fi

LAST_BACKUP=$(get_last_backup)

if [ -n "$LAST_BACKUP" ]; then
  log "Last backup: $LAST_BACKUP — running integrity check"

  CURRENT=$(build_current_snapshot)
  PREVIOUS=$(build_backup_snapshot "$LAST_BACKUP")

  if [ "$AI_AVAILABLE" = true ]; then
    AI_RESULT=$(run_ai_check "$CURRENT" "$PREVIOUS" "$ONECLI_PROXY")
    log "AI check result: $AI_RESULT"

    if [[ "$AI_RESULT" == ALERT:* ]]; then
      log "CORRUPTION DETECTED — skipping backup"
      send_telegram "⚠️ *Memory Backup Alert*

The daily memory backup detected a potential issue and was *skipped* to protect backup integrity.

*Issue:* ${AI_RESULT#ALERT: }

*Action needed:* Review the current memory files in \`groups/\` and compare against the last good backup at:
\`$(basename "$LAST_BACKUP")\`

Run \`scripts/backup-memory.sh\` manually after resolving."
      exit 1
    fi

    if [[ "$AI_RESULT" == ERROR:* ]]; then
      log "AI check returned error — falling back to heuristics"
      AI_AVAILABLE=false
    fi
  fi

  if [ "$AI_AVAILABLE" = false ]; then
    log "Running heuristic check (AI unavailable)"
    # If the AI check is unavailable, do a basic heuristic: check that no file
    # shrank by more than 50%
    HEURISTIC_FAIL=false
    for f in $(find "$GROUPS_DIR" -maxdepth 3 -name '*.md' -type f | sort); do
      rel="${f#$GROUPS_DIR/}"
      backup_file="$LAST_BACKUP/$rel"
      if [ -f "$backup_file" ]; then
        current_size=$(wc -c < "$f")
        backup_size=$(wc -c < "$backup_file")
        if [ "$backup_size" -gt 100 ] && [ "$current_size" -lt $((backup_size / 2)) ]; then
          log "HEURISTIC ALERT: $rel shrank from ${backup_size}B to ${current_size}B"
          send_telegram "⚠️ *Memory Backup Alert*

AI check unavailable, but heuristic check found that \`$rel\` shrank from ${backup_size}B to ${current_size}B (>50% reduction).

Backup *skipped*. Please review."
          HEURISTIC_FAIL=true
          break
        fi
      fi
    done
    if [ "$HEURISTIC_FAIL" = true ]; then
      exit 1
    fi
  fi
else
  log "No previous backup found — skipping integrity check (first run)"
fi

# Proceed with backup
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SNAPSHOT_DIR="$BACKUP_ROOT/$TIMESTAMP"
mkdir -p "$SNAPSHOT_DIR"

find "$GROUPS_DIR" -maxdepth 3 \( -name '*.md' -o -name '*.json' \) -type f | while read -r src; do
  rel="${src#$GROUPS_DIR/}"
  dest="$SNAPSHOT_DIR/$rel"
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
done

# Prune old snapshots
snapshot_count="$(find "$BACKUP_ROOT" -maxdepth 1 -mindepth 1 -type d | wc -l)"
if [ "$snapshot_count" -gt "$MAX_SNAPSHOTS" ]; then
  find "$BACKUP_ROOT" -maxdepth 1 -mindepth 1 -type d | sort | head -n "$(( snapshot_count - MAX_SNAPSHOTS ))" | while read -r old; do
    rm -rf "$old"
  done
fi

log "Backup complete: $SNAPSHOT_DIR"
