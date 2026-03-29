# Backup & Sync Architecture

## Overview

NanoClaw uses a three-layer data protection stack:

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: Local Memory Backup (backup-memory.sh)        │
│  AI integrity check → local snapshots in data/          │
├─────────────────────────────────────────────────────────┤
│  Layer 2: Offsite Backup (restic → Backblaze B2)        │
│  Encrypted, deduplicated, versioned → cloud             │
├─────────────────────────────────────────────────────────┤
│  Layer 3: Multi-Machine Sync (Syncthing) [NOT YET ACTIVE]│
│  Real-time peer-to-peer sync between machines           │
└─────────────────────────────────────────────────────────┘
```

## Layer 1: Local Memory Backup

**Script:** `scripts/backup-memory.sh`
**Schedule:** Daily at 03:00 UTC (system cron)
**Log:** `logs/backup.log`

### What it does

1. Resolves an OneCLI agent token (dynamic → cached → hardcoded fallback)
2. Compares current memory files against the last backup using Claude Haiku
3. If corruption detected → sends Telegram alert, skips backup
4. If AI unavailable → falls back to heuristic check (>50% file size reduction)
5. If API access broken → sends Telegram alert with fix instructions
6. Copies all `.md` and `.json` files from `groups/` to a timestamped snapshot
7. Prunes snapshots beyond 30

### Backup location

```
data/memory-backups/
├── 20260327T100428Z/
│   ├── global/CLAUDE.md
│   ├── global/preferences.md
│   ├── telegram_main/CLAUDE.md
│   ├── telegram_main/preferences.md
│   ├── telegram_main/daily_update/config.json
│   ├── whatsapp_main/CLAUDE.md
│   └── whatsapp_main/preferences.md
├── 20260328T030000Z/
└── ...
```

### Restoring from a local backup

```bash
# List available snapshots
ls data/memory-backups/

# Compare a file against a backup
diff groups/global/preferences.md data/memory-backups/20260327T100428Z/global/preferences.md

# Restore a specific file
cp data/memory-backups/20260327T100428Z/global/preferences.md groups/global/preferences.md
```

---

## Layer 2: Offsite Backup (Restic → Backblaze B2)

**Script:** `scripts/restic-backup.sh`
**Schedule:** Daily at 03:30 UTC (system cron, 30 min after memory backup)
**Log:** `logs/restic.log`
**Config:** `~/.config/nanoclaw/restic.env` (owner-only permissions)

### What it backs up

| Path | Content |
|------|---------|
| `groups/` | Channel memory, CLAUDE.md, preferences, daily update config |
| `store/` | SQLite database (messages, scheduled tasks, registered groups) |
| `data/memory-backups/` | Local memory backup snapshots |
| `~/.claude/projects/-home-nanoclaw-NanoClaw/memory/` | Claude Code project memory |

### Security

- **Client-side encryption**: restic encrypts all data with AES-256 before upload using your passphrase. Backblaze never sees plaintext.
- **In-transit encryption**: TLS to B2 API.
- **At-rest encryption**: B2 server-side encryption (additional layer).
- **Passphrase**: stored only in `~/.config/nanoclaw/restic.env` (mode 600). **If lost, backups are unrecoverable.** Store a copy in a password manager.

### Retention policy

- 7 daily snapshots
- 4 weekly snapshots
- 6 monthly snapshots
- Older snapshots pruned automatically after each backup

### Setup (one-time)

```bash
# 1. Create Backblaze B2 account: https://www.backblaze.com/sign-up/cloud-storage
# 2. Create a private bucket (e.g. "nanoclaw-backups")
# 3. Create an application key scoped to that bucket
# 4. Edit the config:
nano ~/.config/nanoclaw/restic.env

# 5. Initialize the restic repository:
scripts/restic-backup.sh init

# 6. Test:
scripts/restic-backup.sh backup
```

### Common operations

```bash
# Run a backup manually
scripts/restic-backup.sh backup

# List all snapshots
scripts/restic-backup.sh snapshots

# Restore latest snapshot to a directory
scripts/restic-backup.sh restore latest /tmp/nanoclaw-restore

# Restore a specific snapshot
scripts/restic-backup.sh restore abc123 /tmp/nanoclaw-restore

# Manual prune
scripts/restic-backup.sh prune

# Browse a snapshot interactively
source ~/.config/nanoclaw/restic.env
restic ls latest

# Restore a single file
restic restore latest --target /tmp/restore --include "groups/global/preferences.md"
```

### Failure alerts

If the backup fails or B2 credentials aren't configured, a Telegram message is sent with instructions.

---

## Layer 3: Multi-Machine Sync (Syncthing) — NOT YET ACTIVE

**Binary:** installed at `~/.local/bin/syncthing` (v1.29.5)
**Status:** Installed, not configured. Activate when a second machine (Mac) is ready.

### Purpose

Real-time peer-to-peer sync between the Linux server and a Mac. Unlike restic (which is backup/restore), Syncthing keeps files identical across machines as they change.

### Planned architecture

```
Mac (NanoClaw + Claude project)
  ↕  Syncthing (encrypted, peer-to-peer, no cloud intermediary)
Linux server (NanoClaw + Claude project)
  ↓                    ↓
  restic               restic
  ↓                    ↓
  Backblaze B2 (shared or separate repos)
```

### What to sync

| Directory | Sync? | Notes |
|-----------|-------|-------|
| `groups/` | Yes | Channel memory, preferences |
| `store/messages.db` | Careful | SQLite + bidirectional sync = risk of corruption. May need a different strategy (e.g. DB replication, or one machine as primary). |
| Claude project memory | Yes | `~/.claude/projects/.../memory/` |
| Notes/files/images | Yes | Whatever content directory is established |
| `src/`, `dist/`, `node_modules/` | No | Code managed by git, deps by npm |
| `data/` | No | Local runtime state, backed up by restic |
| `logs/` | No | Machine-specific |

### Setup steps (for when ready)

```bash
# On Linux server:
syncthing serve --no-browser

# On Mac:
brew install syncthing
syncthing

# Then:
# 1. Access web UIs (localhost:8384 on each machine)
# 2. Add each machine as a device (swap device IDs)
# 3. Share the relevant folders
# 4. Set conflict resolution policy (e.g. Linux server wins)
```

### SQLite sync caveat

Syncthing is file-level sync. SQLite databases can corrupt if synced while being written to. Options to handle this:

1. **One primary machine**: Only one machine runs NanoClaw at a time. Syncthing syncs the DB when the other machine is idle.
2. **DB export/import**: Periodically export the DB to JSON/CSV, sync that, import on the other side.
3. **Move to Supabase/Postgres**: Eliminates the file sync problem entirely — both machines connect to the same remote DB.
4. **Litestream**: Streams SQLite changes to S3/B2 in real-time. The other machine restores from the stream. One-directional but reliable.

Recommendation: if both machines will run NanoClaw simultaneously, move to Supabase. If only one runs at a time, Syncthing with "pause before switching" is fine.

---

## Cron Schedule

```
00 03 * * *  backup-memory.sh   # Local memory backup with AI integrity check
30 03 * * *  restic-backup.sh   # Offsite encrypted backup to B2
```

All times UTC. Memory backup runs first so the AI check catches corruption before restic snapshots it offsite.

---

## Disaster Recovery

### Scenario: Memory file corrupted

1. Check local backups: `ls data/memory-backups/`
2. Diff against last good snapshot
3. Copy the good version back

### Scenario: Server disk failure

1. Provision new server
2. Install restic, configure `restic.env` with same credentials
3. `scripts/restic-backup.sh restore latest /tmp/restore`
4. Move restored files into place
5. Reinstall NanoClaw from git, restore `groups/` and `store/`

### Scenario: Backblaze account compromised

Attacker gets encrypted blobs. Without your restic passphrase, data is unrecoverable by them. Rotate B2 app keys, re-init a new repo if desired.

### Scenario: Restic passphrase lost

Backups are permanently unrecoverable. This is by design (client-side encryption). Local backups in `data/memory-backups/` are still available (unencrypted, on-disk).
