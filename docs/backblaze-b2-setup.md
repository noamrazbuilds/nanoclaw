# Backblaze B2 Setup for NanoClaw Offsite Backup

## Overview

This guide walks through setting up Backblaze B2 as the offsite backup destination for NanoClaw. Once complete, all memory files, the SQLite database, and Claude project data will be encrypted and backed up to B2 nightly.

**Time required:** ~10 minutes
**Cost:** Free for the first 10GB (you'll use well under 1GB initially)

---

## Step 1: Create a Backblaze Account

1. Go to https://www.backblaze.com/sign-up/cloud-storage
2. Sign up with email + password
3. Verify your email
4. You do NOT need to enter payment info for the free tier (10GB storage, 10GB/day download)

## Step 2: Create a B2 Bucket

1. Log in to https://secure.backblaze.com
2. In the left sidebar, click **B2 Cloud Storage** → **Buckets**
3. Click **Create a Bucket**
4. Settings:
   - **Bucket Name:** `nanoclaw-backups` (must be globally unique — add a suffix if taken, e.g. `nanoclaw-backups-nraz`)
   - **Files in Bucket are:** **Private**
   - **Default Encryption:** **Enable** (server-side encryption, adds a layer on top of restic's client-side encryption)
   - **Object Lock:** Leave disabled
5. Click **Create a Bucket**
6. Note the **Endpoint** shown on the bucket page — it looks like `s3.us-west-004.backblazeb2.com`. You'll need this.

## Step 3: Create an Application Key

1. In the left sidebar, click **Application Keys**
2. Click **Add a New Application Key**
3. Settings:
   - **Name of Key:** `nanoclaw-restic`
   - **Allow access to Bucket(s):** Select your bucket (e.g. `nanoclaw-backups`)
   - **Type of Access:** **Read and Write**
   - **Allow List All Bucket Names:** Leave checked
   - **File name prefix:** Leave empty
   - **Duration:** Leave empty (no expiration)
4. Click **Create New Key**
5. **IMPORTANT:** Copy both values immediately — the application key is shown only once:
   - **keyID** — this is your `B2_ACCOUNT_ID`
   - **applicationKey** — this is your `B2_ACCOUNT_KEY`

## Step 4: Configure NanoClaw

SSH into the NanoClaw server and edit the restic config file:

```bash
nano ~/.config/nanoclaw/restic.env
```

Fill in the four values:

```bash
# Backblaze B2 credentials (from Step 3)
export B2_ACCOUNT_ID="your-keyID-here"
export B2_ACCOUNT_KEY="your-applicationKey-here"

# Restic repository (from Step 2 — use your bucket's endpoint and name)
export RESTIC_REPOSITORY="s3:https://s3.us-west-004.backblazeb2.com/nanoclaw-backups"

# Restic encryption passphrase — CHOOSE A STRONG ONE
# This is the ONLY key to decrypt your backups.
# If you lose it, backups are permanently unrecoverable.
# Store a copy in your password manager (1Password, Bitwarden, etc.)
export RESTIC_PASSWORD="your-strong-passphrase-here"
```

**Passphrase tips:**
- Use 4+ random words or a 20+ character string
- Do NOT reuse a password from another service
- Store it in your password manager immediately after setting it
- Consider also writing it down and keeping it in a secure physical location

Save and exit (`Ctrl+X`, `Y`, `Enter` in nano).

## Step 5: Initialize the Restic Repository

This creates the encrypted repository structure in your B2 bucket. Run it once:

```bash
cd ~/NanoClaw
scripts/restic-backup.sh init
```

Expected output:
```
[timestamp] Initializing restic repository: s3:https://s3.us-west-004.backblazeb2.com/nanoclaw-backups
created restic repository ... at s3:https://s3.us-west-004.backblazeb2.com/nanoclaw-backups
[timestamp] Repository initialized
```

If you see an error about credentials, double-check the `B2_ACCOUNT_ID` and `B2_ACCOUNT_KEY` values.

## Step 6: Run the First Backup

```bash
scripts/restic-backup.sh backup
```

This will:
1. Back up `groups/`, `store/`, `data/memory-backups/`, and Claude project memory
2. Encrypt everything with your passphrase before uploading
3. Prune old snapshots per the retention policy (7 daily, 4 weekly, 6 monthly)

Expected output includes lines like:
```
repository ... opened (version 2, compression level auto)
[0:00] 100.00%  X files, Y.YY MiB
snapshot abc12345 saved
```

## Step 7: Verify

```bash
# List snapshots
scripts/restic-backup.sh snapshots

# Check the B2 web console — you should see encrypted files in your bucket
```

---

## You're Done

The nightly cron is already configured:
- **03:00 UTC** — `backup-memory.sh` runs the AI integrity check and creates a local snapshot
- **03:30 UTC** — `restic-backup.sh` encrypts and uploads everything to B2

If anything goes wrong, you'll get a Telegram notification.

---

## Quick Reference

| Task | Command |
|------|---------|
| Manual backup | `scripts/restic-backup.sh backup` |
| List snapshots | `scripts/restic-backup.sh snapshots` |
| Restore latest | `scripts/restic-backup.sh restore latest /tmp/restore` |
| Restore specific | `scripts/restic-backup.sh restore <snapshot-id> /tmp/restore` |
| Restore one file | `source ~/.config/nanoclaw/restic.env && restic restore latest --target /tmp/restore --include "groups/global/preferences.md"` |
| Manual prune | `scripts/restic-backup.sh prune` |
| Check logs | `cat logs/restic.log` |

## Troubleshooting

**"invalid credentials"** — The keyID or applicationKey is wrong. Re-check in the Backblaze console. If the key was deleted, create a new one.

**"repository not found"** — The RESTIC_REPOSITORY URL doesn't match your bucket. Verify the endpoint region and bucket name.

**"wrong password"** — The RESTIC_PASSWORD doesn't match what was used during `init`. If you've lost it and can't recover from your password manager, you'll need to delete the bucket contents and re-init (losing existing backup history).

**Backup seems stuck** — Large first backup on a slow connection can take a while. Subsequent backups are fast due to deduplication. Check `logs/restic.log` for progress.
