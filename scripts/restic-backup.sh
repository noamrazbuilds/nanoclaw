#!/bin/bash
# Offsite backup using restic → Backblaze B2.
# Backs up NanoClaw data, memory, SQLite DB, and Claude project files.
#
# Usage:
#   scripts/restic-backup.sh init      # One-time: initialize the restic repo
#   scripts/restic-backup.sh backup    # Run a backup snapshot
#   scripts/restic-backup.sh snapshots # List existing snapshots
#   scripts/restic-backup.sh restore <snapshot> <target-dir>  # Restore a snapshot
#   scripts/restic-backup.sh prune     # Remove old snapshots per retention policy
#
# Cron (runs daily at 3:30 AM UTC, 30 min after the memory backup script):
#   30 3 * * * /home/nanoclaw/NanoClaw/scripts/restic-backup.sh backup >> /home/nanoclaw/NanoClaw/logs/restic.log 2>&1

set -euo pipefail

# Ensure locally-installed binaries are in PATH (cron doesn't load .bashrc)
export PATH="/home/nanoclaw/.local/bin:$PATH"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="/home/nanoclaw/.config/nanoclaw/restic.env"
LOG_FILE="$PROJECT_ROOT/logs/restic.log"
TELEGRAM_CHAT_ID="145958767"

# Load NanoClaw .env for Telegram token
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

# Load restic config
if [ ! -f "$CONFIG_FILE" ]; then
  echo "ERROR: Config file not found: $CONFIG_FILE"
  echo "Run the setup steps in that file first."
  exit 1
fi
source "$CONFIG_FILE"

# Validate config
if [ -z "${RESTIC_REPOSITORY:-}" ] || [ -z "${RESTIC_PASSWORD:-}" ]; then
  echo "ERROR: RESTIC_REPOSITORY and RESTIC_PASSWORD must be set in $CONFIG_FILE"
  exit 1
fi

# What to back up
BACKUP_PATHS=(
  "$PROJECT_ROOT/groups"                                                # Channel memory, CLAUDE.md, preferences
  "$PROJECT_ROOT/store"                                                 # SQLite database (messages, tasks, groups)
  "$PROJECT_ROOT/data/memory-backups"                                   # Local memory backup snapshots
  "/home/nanoclaw/.claude/projects/-home-nanoclaw-NanoClaw/memory"      # Claude Code project memory (NanoClaw)
  "/home/nanoclaw/pka/vault"                                            # PKA — all notes (markdown)
  "/home/nanoclaw/pka/db/pka.db"                                        # PKA — synced metadata database
  "/home/nanoclaw/pka/pipeline"                                         # PKA — session pipeline records + onboarding state
  "/home/nanoclaw/pka/MEMORY.md"                                        # PKA — living memory index
  "/home/nanoclaw/pka/HEARTBEAT.md"                                     # PKA — system health
  "/home/nanoclaw/.claude/projects/-home-nanoclaw-pka/memory"           # Claude Code project memory (PKA)
)

# What to exclude
EXCLUDE_ARGS=(
  --exclude="*.log"
  --exclude="*.tmp"
  --exclude="*-journal"        # SQLite WAL journal (transient)
  --exclude="*-wal"            # SQLite WAL file (transient)
  --exclude="node_modules"
)

cmd="${1:-backup}"

case "$cmd" in
  init)
    log "Initializing restic repository: $RESTIC_REPOSITORY"
    restic init
    log "Repository initialized"
    ;;

  backup)
    # Validate that B2 credentials are set
    if [ -z "${B2_ACCOUNT_ID:-}" ] || [ -z "${B2_ACCOUNT_KEY:-}" ]; then
      log "ERROR: B2 credentials not configured — skipping offsite backup"
      send_telegram "⚠️ *Restic Backup Skipped*

B2 credentials not configured in \`~/.config/nanoclaw/restic.env\`.

*To fix, tell Claude Code:*
\`\`\`
The restic backup script needs B2 credentials. Help me set up Backblaze B2 — I need to fill in restic.env and initialize the repo.
\`\`\`"
      exit 1
    fi

    log "Starting restic backup"

    # Filter to paths that actually exist
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

    # Run the backup
    if restic backup "${EXCLUDE_ARGS[@]}" "${VALID_PATHS[@]}" --tag nanoclaw 2>&1 | tee -a "$LOG_FILE"; then
      log "Backup complete"

      # Auto-prune: keep 7 daily, 4 weekly, 6 monthly snapshots
      log "Pruning old snapshots"
      restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune --tag nanoclaw 2>&1 | tee -a "$LOG_FILE"
      log "Prune complete"
    else
      log "ERROR: Backup failed"
      send_telegram "⚠️ *Restic Backup Failed*

The offsite backup to Backblaze B2 failed. Check \`logs/restic.log\` for details."
      exit 1
    fi
    ;;

  snapshots)
    restic snapshots --tag nanoclaw
    ;;

  restore)
    SNAPSHOT="${2:-latest}"
    TARGET="${3:-/tmp/nanoclaw-restore}"
    log "Restoring snapshot $SNAPSHOT to $TARGET"
    mkdir -p "$TARGET"
    restic restore "$SNAPSHOT" --target "$TARGET"
    log "Restore complete: $TARGET"
    ;;

  prune)
    log "Manual prune"
    restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune --tag nanoclaw
    log "Prune complete"
    ;;

  *)
    echo "Usage: $0 {init|backup|snapshots|restore [snapshot] [target]|prune}"
    exit 1
    ;;
esac
