#!/usr/bin/env tsx
/**
 * snapshot-prod-db.ts — WAL-aware snapshot of the v1 production messages.db.
 *
 * Phase 1 (data migration) deliverable per
 * migration-notes/phase-2-revised-plan.md and Q4 in
 * migration-notes/data-migration-gaps.md.
 *
 * Why this exists:
 *   The nanoclaw service is actively writing to ~/NanoClaw/store/messages.db
 *   while it's running (verified 2026-06-03 — WAL mtime within minutes of
 *   check, systemctl status active). A naive `cp` of the .db file risks
 *   capturing a half-written page or missing in-flight WAL writes. SQLite's
 *   backup API copies pages atomically and coordinates with concurrent
 *   writers; better-sqlite3 exposes this via db.backup().
 *
 *   This is the canonical snapshot mechanism for migration testing — the
 *   service stays running, no downtime.
 *
 * Usage:
 *   tsx scripts/snapshot-prod-db.ts [--output <dir>] [--src <path>] [--no-stats]
 *
 * Defaults:
 *   --src     ~/NanoClaw/store/messages.db
 *   --output  ~/nanoclaw-v1-snapshot-YYYYMMDD-HHMMSS/
 *
 * Output structure:
 *   <output-dir>/
 *     store/messages.db        — WAL-checkpointed snapshot
 *     SHA256SUMS               — sha256 of messages.db
 *     SNAPSHOT_DATE            — ISO8601 timestamp of snapshot
 *     STATS.txt                — row counts of key tables (unless --no-stats)
 *     SOURCE.txt               — original path the snapshot came from
 *
 * Exit codes:
 *   0  Snapshot succeeded.
 *   1  Source DB missing, output path exists, or backup failed.
 *   2  Usage error.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';

interface Args {
  src: string;
  output: string;
  stats: boolean;
}

function parseArgs(argv: string[]): Args {
  let src = path.join(os.homedir(), 'NanoClaw', 'store', 'messages.db');
  let output = path.join(
    os.homedir(),
    `nanoclaw-v1-snapshot-${timestamp()}`,
  );
  let stats = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--src':       src = argv[++i]; break;
      case '--output':    output = argv[++i]; break;
      case '--no-stats':  stats = false; break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(2);
        break;
      default:
        console.error(`Unknown arg: ${arg}`);
        process.exit(2);
    }
  }
  return { src, output, stats };
}

function printHelp(): void {
  console.log(`Usage: tsx scripts/snapshot-prod-db.ts [--output <dir>] [--src <path>] [--no-stats]

Snapshots the v1 production messages.db via SQLite's WAL-aware backup API.
Service stays running; snapshot is internally consistent.

Defaults:
  --src     ~/NanoClaw/store/messages.db
  --output  ~/nanoclaw-v1-snapshot-<timestamp>/`);
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

function sha256File(p: string): string {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(p));
  return hash.digest('hex');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(args.src)) {
    console.error(`FATAL: source DB not found: ${args.src}`);
    process.exit(1);
  }

  if (fs.existsSync(args.output)) {
    console.error(`FATAL: output path already exists: ${args.output}`);
    console.error(`       refusing to overwrite — choose a different --output or remove first.`);
    process.exit(1);
  }

  fs.mkdirSync(path.join(args.output, 'store'), { recursive: true });
  const dstDb = path.join(args.output, 'store', 'messages.db');

  // Open source read-only. better-sqlite3's backup() handles WAL safely.
  console.error(`Snapshotting ${args.src} → ${dstDb}`);
  const src = new Database(args.src, { readonly: true, fileMustExist: true });
  try {
    await src.backup(dstDb);
  } finally {
    src.close();
  }

  // Manifest + metadata.
  const dstSha = sha256File(dstDb);
  fs.writeFileSync(
    path.join(args.output, 'SHA256SUMS'),
    `${dstSha}  store/messages.db\n`,
  );
  fs.writeFileSync(
    path.join(args.output, 'SNAPSHOT_DATE'),
    new Date().toISOString() + '\n',
  );
  fs.writeFileSync(
    path.join(args.output, 'SOURCE.txt'),
    args.src + '\n',
  );

  if (args.stats) {
    const snap = new Database(dstDb, { readonly: true });
    try {
      const stats: Record<string, number | string> = {};
      const tables: [string, string][] = [
        ['scheduled_tasks (active)', "SELECT count(*) AS c FROM scheduled_tasks WHERE status='active'"],
        ['scheduled_tasks (total)',  "SELECT count(*) AS c FROM scheduled_tasks"],
        ['registered_groups',        "SELECT count(*) AS c FROM registered_groups"],
        ['reactions',                "SELECT count(*) AS c FROM reactions"],
        ['messages',                 "SELECT count(*) AS c FROM messages"],
        ['chats',                    "SELECT count(*) AS c FROM chats"],
        ['task_audit_log',           "SELECT count(*) AS c FROM task_audit_log"],
        ['arena_sessions',           "SELECT count(*) AS c FROM arena_sessions"],
        ['arena_logs',               "SELECT count(*) AS c FROM arena_logs"],
        ['arena_grades',             "SELECT count(*) AS c FROM arena_grades"],
      ];
      for (const [label, sql] of tables) {
        try {
          const row = snap.prepare(sql).get() as { c: number };
          stats[label] = row.c;
        } catch (err) {
          // Table doesn't exist (older v1 install missing later fork-only tables).
          stats[label] = '(table missing)';
        }
      }
      const lines = Object.entries(stats).map(([k, v]) => `  ${k}: ${v}`);
      const block = lines.join('\n') + '\n';
      fs.writeFileSync(path.join(args.output, 'STATS.txt'), block);
      console.error('Row counts:\n' + block);
    } finally {
      snap.close();
    }
  }

  console.error(`Snapshot complete: ${args.output}`);
  console.error(`SHA-256: ${dstSha}`);
  console.log(args.output);
}

main().catch((err) => {
  console.error(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
