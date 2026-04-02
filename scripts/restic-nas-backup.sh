#!/bin/bash
# Local NAS backup using restic → Synology NAS via rclone SFTP.
# Backs up PKA vault, database, pipeline, and Claude project memory.
# Complements the B2 offsite backup — provides fast local restore without internet.
#
# Usage:
#   scripts/restic-nas-backup.sh init      # One-time: initialize the restic repo on NAS
#   scripts/restic-nas-backup.sh backup    # Run a backup snapshot
#   scripts/restic-nas-backup.sh snapshots # List existing snapshots
#   scripts/restic-nas-backup.sh restore <snapshot> <target-dir>  # Restore a snapshot
#   scripts/restic-nas-backup.sh prune     # Remove old snapshots per retention policy
#
# Cron (runs daily at 4:30 AM UTC):
#   30 4 * * * /home/nanoclaw/NanoClaw/scripts/restic-nas-backup.sh backup >> /home/nanoclaw/NanoClaw/logs/restic-nas.log 2>&1
#
# Dependencies:
#   - rclone installed at ~/.local/bin/rclone
#   - rclone remote "nas" configured at ~/.config/rclone/rclone.conf (SFTP to Synology)
#   - restic installed at ~/.local/bin/restic

set -euo pipefail

export PATH="/home/nanoclaw/.local/bin:$PATH"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="/home/nanoclaw/.config/nanoclaw/restic-nas.env"
LOG_FILE="$PROJECT_ROOT/logs/restic-nas.log"
TELEGRAM_CHAT_ID="145958767"

source "$PROJECT_ROOT/.env"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"
}

send_telegram() {
  local msg="$1"
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="$TELEGRAM_CHAT_ID" \
    -d text="$msg" \
    -d parse_mode="Markdown" > /dev/null 2>&1
}

if [ ! -f "$CONFIG_FILE" ]; then
  echo "ERROR: Config file not found: $CONFIG_FILE"
  exit 1
fi
source "$CONFIG_FILE"

BACKUP_PATHS=(
  "/home/nanoclaw/pka/vault"                                            # PKA — all notes (markdown)
  "/home/nanoclaw/pka/db/pka.db"                                        # PKA — synced metadata database
  "/home/nanoclaw/pka/pipeline"                                         # PKA — session pipeline records + onboarding state
  "/home/nanoclaw/pka/MEMORY.md"                                        # PKA — living memory index
  "/home/nanoclaw/pka/HEARTBEAT.md"                                     # PKA — system health
  "/home/nanoclaw/.claude/projects/-home-nanoclaw-pka/memory"           # Claude Code project memory (PKA)
)

EXCLUDE_ARGS=(
  --exclude="*.log"
  --exclude="*.tmp"
  --exclude="*-journal"
  --exclude="*-wal"
  --exclude="*.pyc"
  --exclude="__pycache__"
)

cmd="${1:-backup}"

case "$cmd" in
  init)
    log "Initializing restic NAS repository: $RESTIC_REPOSITORY"
    restic init
    log "NAS repository initialized"
    ;;

  backup)
    # Check NAS reachability via Tailscale ping
    if ! ping -c 1 -W 3 "$NAS_SSH_HOST" > /dev/null 2>&1; then
      log "NAS not reachable ($NAS_SSH_HOST) — skipping NAS backup (will retry tomorrow)"
      exit 0
    fi

    log "Starting NAS backup"

    VALID_PATHS=()
    for p in "${BACKUP_PATHS[@]}"; do
      if [ -e "$p" ]; then
        VALID_PATHS+=("$p")
      else
        log "Skipping non-existent path: $p"
      fi
    done

    if [ ${#VALID_PATHS[@]} -eq 0 ]; then
      log "ERROR: No valid backup paths found"
      exit 1
    fi

    if restic backup "${EXCLUDE_ARGS[@]}" "${VALID_PATHS[@]}" --tag pka 2>&1 | tee -a "$LOG_FILE"; then
      log "NAS backup complete"

      log "Pruning old NAS snapshots"
      restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune --tag pka 2>&1 | tee -a "$LOG_FILE"
      log "NAS prune complete"
    else
      log "ERROR: NAS backup failed"
      send_telegram "⚠️ *NAS Backup Failed*

The PKA backup to the Synology NAS failed. Check \`logs/restic-nas.log\` for details.

The B2 offsite backup is unaffected."
      exit 1
    fi
    ;;

  snapshots)
    restic snapshots --tag pka
    ;;

  restore)
    SNAPSHOT="${2:-latest}"
    TARGET="${3:-/tmp/pka-restore}"
    log "Restoring snapshot $SNAPSHOT to $TARGET"
    mkdir -p "$TARGET"
    restic restore "$SNAPSHOT" --target "$TARGET"
    log "Restore complete: $TARGET"
    ;;

  prune)
    log "Manual prune"
    restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune --tag pka
    log "Prune complete"
    ;;

  *)
    echo "Usage: $0 {init|backup|snapshots|restore [snapshot] [target]|prune}"
    exit 1
    ;;
esac
