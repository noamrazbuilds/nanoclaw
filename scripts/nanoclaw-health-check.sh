#!/bin/bash
# NanoClaw v2 health watchdog
# Runs every 5 minutes via nanoclaw-watchdog.timer.
# Checks the nanoclaw service + Docker, restarts nanoclaw if dead, alerts via Telegram.
# Ported from v1 (scripts/nanoclaw-health-check.sh); v2 paths, missile-listener dropped.

set -euo pipefail

NANOCLAW_DIR="/home/nanoclaw/nanoclaw-v2"
LOG_FILE="$NANOCLAW_DIR/logs/watchdog.log"
ENV_FILE="$NANOCLAW_DIR/.env"

# Load env for bot token and chat ID
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
fi

BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
ALERT_CHAT_ID="${WATCHDOG_ALERT_CHAT_ID:-145958767}"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG_FILE"
}

tg_alert() {
  local msg="$1"
  if [[ -z "$BOT_TOKEN" ]]; then
    log "WARN: No TELEGRAM_BOT_TOKEN set, cannot send alert"
    return
  fi
  # jq builds the JSON so $msg is properly escaped (a stray quote/backslash in an
  # error detail would otherwise malform the body). Try Markdown first; if
  # Telegram rejects it (HTTP 400 — bad markdown), retry as PLAIN TEXT so the
  # alert-of-last-resort still reaches the user instead of silently failing.
  local text="🔧 NanoClaw Watchdog
${msg}"
  local body code
  if command -v jq >/dev/null 2>&1; then
    body="$(jq -nc --arg c "$ALERT_CHAT_ID" --arg t "$text" '{chat_id:$c, text:$t, parse_mode:"Markdown"}')"
  else
    # Fallback if jq is absent: minimal manual escaping of " and newlines.
    local esc="${msg//\\/\\\\}"; esc="${esc//\"/\\\"}"; esc="${esc//$'\n'/\\n}"
    body="{\"chat_id\":\"${ALERT_CHAT_ID}\",\"text\":\"🔧 NanoClaw Watchdog\\n${esc}\",\"parse_mode\":\"Markdown\"}"
  fi
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST \
    "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" -d "$body" 2>/dev/null || echo 000)
  if [[ "$code" == "400" ]]; then
    log "Telegram Markdown rejected (400); retrying alert as plain text"
    local plain
    if command -v jq >/dev/null 2>&1; then
      plain="$(jq -nc --arg c "$ALERT_CHAT_ID" --arg t "$text" '{chat_id:$c, text:$t}')"
    else
      local esc2="${msg//\\/\\\\}"; esc2="${esc2//\"/\\\"}"; esc2="${esc2//$'\n'/\\n}"
      plain="{\"chat_id\":\"${ALERT_CHAT_ID}\",\"text\":\"🔧 NanoClaw Watchdog\\n${esc2}\"}"
    fi
    curl -s --max-time 10 -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
      -H "Content-Type: application/json" -d "$plain" --output /dev/null || true
  fi
}

# --- Check nanoclaw ---
if ! systemctl --user is-active --quiet nanoclaw; then
  log "nanoclaw is NOT active — attempting restart"
  if systemctl --user restart nanoclaw; then
    sleep 5
    if systemctl --user is-active --quiet nanoclaw; then
      log "nanoclaw restarted successfully"
      tg_alert "⚠️ nanoclaw was down and has been *restarted successfully*."
    else
      log "nanoclaw restart failed"
      tg_alert "🚨 nanoclaw is *DOWN* and restart failed. Manual intervention needed."
    fi
  else
    log "systemctl restart nanoclaw failed"
    tg_alert "🚨 nanoclaw is *DOWN* — restart command failed. Check the server."
  fi
else
  log "nanoclaw OK"
fi

# --- Check Docker (agents can't run without it) ---
if ! docker info --format '{{.ServerVersion}}' &>/dev/null; then
  log "Docker is unreachable"
  tg_alert "🚨 Docker is *unreachable*. NanoClaw agents cannot run. Check the server."
else
  log "Docker OK"
fi
