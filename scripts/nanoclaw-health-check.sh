#!/bin/bash
# NanoClaw health watchdog
# Runs every 5 minutes via nanoclaw-watchdog.timer
# Checks nanoclaw + missile-listener, restarts if dead, alerts via Telegram.

set -euo pipefail

NANOCLAW_DIR="/home/nanoclaw/NanoClaw"
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
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\": \"${ALERT_CHAT_ID}\", \"text\": \"🔧 NanoClaw Watchdog\\n${msg}\", \"parse_mode\": \"Markdown\"}" \
    --max-time 10 \
    --silent \
    --output /dev/null || true
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

# --- Check missile-listener ---
if systemctl is-active --quiet missile-listener.service 2>/dev/null; then
  log "missile-listener OK"
elif systemctl list-unit-files missile-listener.service &>/dev/null; then
  log "missile-listener is NOT active — attempting restart"
  if sudo systemctl restart missile-listener.service 2>/dev/null; then
    log "missile-listener restarted"
    tg_alert "⚠️ missile-listener was down and has been *restarted*."
  else
    log "missile-listener restart failed (may need sudo or service not installed)"
  fi
fi

# --- Check Docker ---
if ! docker info --format '{{.ServerVersion}}' &>/dev/null; then
  log "Docker is unreachable"
  tg_alert "🚨 Docker is *unreachable*. NanoClaw agents cannot run. Check the server."
else
  log "Docker OK"
fi
