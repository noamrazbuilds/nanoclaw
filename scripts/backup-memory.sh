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

# Ensure ~/.local/bin is on PATH (cron uses a minimal PATH)
export PATH="$HOME/.local/bin:$PATH"

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

# Build a diff-only snapshot: only include files that changed, were added, or removed.
# Returns paired PREVIOUS/CURRENT blocks for each changed file so the AI can compare.
build_diff_snapshot() {
  local backup_dir="$1"
  local output=""
  local changed=0

  # Check files that exist now (changed or new)
  # Skip conversation logs — they're append-only transcripts, not integrity-sensitive
  for f in $(find "$GROUPS_DIR" -maxdepth 3 \( -name '*.md' \) -not -path '*/conversations/*' -type f | sort); do
    local rel="${f#$GROUPS_DIR/}"
    local backup_file="$backup_dir/$rel"
    if [ -f "$backup_file" ]; then
      if ! diff -q "$f" "$backup_file" > /dev/null 2>&1; then
        local cur_size=$(wc -c < "$f")
        local bak_size=$(wc -c < "$backup_file")
        output+="--- CHANGED: $rel (was ${bak_size}B, now ${cur_size}B) ---"$'\n'
        output+="PREVIOUS:"$'\n'"$(cat "$backup_file")"$'\n'$'\n'
        output+="CURRENT:"$'\n'"$(cat "$f")"$'\n'$'\n'
        changed=$((changed + 1))
      fi
    else
      local cur_size=$(wc -c < "$f")
      output+="--- NEW FILE: $rel (${cur_size}B) ---"$'\n'
      output+="$(cat "$f")"$'\n'$'\n'
      changed=$((changed + 1))
    fi
  done

  # Check for deleted files (in backup but not current)
  for f in $(find "$backup_dir" -maxdepth 3 -name '*.md' -not -path '*/conversations/*' -type f | sort); do
    local rel="${f#$backup_dir/}"
    if [ ! -f "$GROUPS_DIR/$rel" ]; then
      local bak_size=$(wc -c < "$f")
      output+="--- DELETED: $rel (was ${bak_size}B) ---"$'\n'
      output+="$(cat "$f")"$'\n'$'\n'
      changed=$((changed + 1))
    fi
  done

  if [ "$changed" -eq 0 ]; then
    echo ""
  else
    echo "$output"
  fi
}

# Run AI integrity check on the diff between current files and last backup
run_ai_check() {
  local diff_snapshot="$1"
  local proxy="$2"

  local prompt="You are a memory file integrity checker for a personal AI assistant called The Dude. Below are the files that CHANGED since the last backup. Each entry shows the PREVIOUS and CURRENT version of the file. Check for corruption or unwanted changes.

Signs of corruption or problems:
- Key sections completely wiped or replaced with unrelated content
- Existing preferences reversed (e.g. a rule previously saying 'never guess' now says 'always guess')
- Files drastically shorter with important content missing (not just reformatted or moved to another file)
- Garbled text, encoding issues, or nonsense content
- Identity information changed (name, email, contact info altered)
- Communication style rules reversed or removed without apparent reason

NOT corruption (normal changes — do NOT flag these):
- New preferences or rules added (even strict-sounding ones like 'X is mandatory')
- New sections added to existing files
- Wording refined while keeping the same meaning
- Files reorganized or restructured (content moved between files)
- New files added (build specs, feature docs, temp files — all normal)
- Minor formatting changes
- A file shrinking because its content was moved to a shared/global file

IMPORTANT: Only flag ALERT if existing content was corrupted, reversed, or destroyed. New additions are NEVER corruption — they are normal evolution of the assistant's instructions.

Respond with EXACTLY one line:
- If everything looks fine: OK
- If something looks wrong: ALERT: [brief description of the issue]

CHANGES SINCE LAST BACKUP:
$diff_snapshot"

  # Build the JSON payload to a temp file (avoids bash argument size limits)
  local payload_file
  payload_file=$(mktemp)
  trap "rm -f '$payload_file'" RETURN

  python3 -c "
import json, sys
prompt = sys.stdin.read()
json.dump({
    'model': 'claude-haiku-4-5-20251001',
    'max_tokens': 200,
    'messages': [{'role': 'user', 'content': prompt}]
}, sys.stdout)
" <<< "$prompt" > "$payload_file"

  local response curl_exit
  response=$(curl -s --max-time 60 --proxy "$proxy" --cacert "$ONECLI_CA" \
    -X POST "https://api.anthropic.com/v1/messages" \
    -H "Content-Type: application/json" \
    -H "x-api-key: placeholder" \
    -H "anthropic-version: 2023-06-01" \
    -d @"$payload_file" 2>/dev/null) || curl_exit=$?

  if [ -n "${curl_exit:-}" ]; then
    echo "ERROR: curl failed with exit code $curl_exit"
    return
  fi

  if [ -z "$response" ]; then
    echo "ERROR: curl returned empty response"
    return
  fi

  # Extract the text from the response, with proper error handling
  echo "$response" | python3 -c "
import sys, json
raw = sys.stdin.read()
try:
    data = json.loads(raw)
    if data.get('type') == 'message':
        print(data['content'][0]['text'])
    elif data.get('type') == 'error':
        err = data.get('error', {})
        print(f'ERROR: API returned {err.get(\"type\", \"unknown\")}: {err.get(\"message\", \"no details\")}')
    else:
        print(f'ERROR: Unexpected response type: {data.get(\"type\", \"missing\")}')
except json.JSONDecodeError:
    print(f'ERROR: Response was not valid JSON: {raw[:200]}')
except Exception as e:
    print(f'ERROR: {e}')
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

  DIFF_SNAPSHOT=$(build_diff_snapshot "$LAST_BACKUP")

  if [ -z "$DIFF_SNAPSHOT" ]; then
    log "No files changed since last backup — skipping integrity check"
  elif [ "$AI_AVAILABLE" = true ]; then
    DIFF_SIZE=${#DIFF_SNAPSHOT}
    log "Diff snapshot size: ${DIFF_SIZE} bytes"
    AI_RESULT=$(run_ai_check "$DIFF_SNAPSHOT" "$ONECLI_PROXY")
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
    # Heuristic: flag files that shrank >50%, but only alert if the total across
    # all groups also shrank >20% (to avoid false positives from content being
    # moved between files, e.g. from a group CLAUDE.md to global CLAUDE.md).
    TOTAL_CURRENT=0
    TOTAL_BACKUP=0
    SHRUNK_FILES=""
    for f in $(find "$GROUPS_DIR" -maxdepth 3 -name '*.md' -type f | sort); do
      rel="${f#$GROUPS_DIR/}"
      current_size=$(wc -c < "$f")
      TOTAL_CURRENT=$((TOTAL_CURRENT + current_size))
      backup_file="$LAST_BACKUP/$rel"
      if [ -f "$backup_file" ]; then
        backup_size=$(wc -c < "$backup_file")
        TOTAL_BACKUP=$((TOTAL_BACKUP + backup_size))
        if [ "$backup_size" -gt 100 ] && [ "$current_size" -lt $((backup_size / 2)) ]; then
          SHRUNK_FILES+="$rel (${backup_size}B → ${current_size}B)"$'\n'
        fi
      fi
    done
    # Also count backup-only files (deleted)
    for f in $(find "$LAST_BACKUP" -maxdepth 3 -name '*.md' -type f | sort); do
      rel="${f#$LAST_BACKUP/}"
      if [ ! -f "$GROUPS_DIR/$rel" ]; then
        backup_size=$(wc -c < "$f")
        TOTAL_BACKUP=$((TOTAL_BACKUP + backup_size))
        SHRUNK_FILES+="$rel (${backup_size}B → DELETED)"$'\n'
      fi
    done

    if [ -n "$SHRUNK_FILES" ]; then
      log "Files that shrank >50%: $(echo "$SHRUNK_FILES" | tr '\n' '; ')"
      # Only alert if total also dropped significantly (content wasn't just moved)
      if [ "$TOTAL_BACKUP" -gt 0 ] && [ "$TOTAL_CURRENT" -lt $((TOTAL_BACKUP * 80 / 100)) ]; then
        log "HEURISTIC ALERT: total also shrank (${TOTAL_BACKUP}B → ${TOTAL_CURRENT}B) — likely real data loss"
        send_telegram "⚠️ *Memory Backup Alert*

AI check unavailable. Heuristic found shrunk files AND total size dropped >20%:

$(echo "$SHRUNK_FILES" | head -5 | sed 's/^/• /')

Total: ${TOTAL_BACKUP}B → ${TOTAL_CURRENT}B

Backup *skipped*. Please review."
        exit 1
      else
        log "Files shrank but total is stable (${TOTAL_BACKUP}B → ${TOTAL_CURRENT}B) — likely reorganized, proceeding"
      fi
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
