#!/usr/bin/env tsx
/**
 * backup-sheets.ts — host-side snapshot of critical Google Sheets to local disk.
 *
 * Belt-and-suspenders on top of the gws-proxy's destructive-op block: two Sheets
 * were silently lost (concert 2026-05, quote-log 2026-05) and recovery was an
 * iCloud scramble. This exports each configured sheet to a timestamped .json
 * snapshot under data/sheet-backups/<key>/ so any future loss is a 1-minute
 * restore. Runs the gws binary directly on the host (creds in ~/.config/gws).
 *
 * Reads the sheet list from data/sheet-backups/sheets.json:
 *   [{ "key": "concert", "spreadsheetId": "...", "range": "'Upcoming Concerts'!A:Z" }, ...]
 * (range optional — defaults to the whole first sheet).
 *
 * Keeps the last KEEP snapshots per sheet (default 12). Idempotent; safe to cron.
 *
 * Usage: tsx scripts/backup-sheets.ts [--stamp <iso>]   (host cron / manual)
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { DATA_DIR } from '../src/config.js';

const GWS = process.env.GWS_BINARY_PATH || 'gws';
const BACKUP_DIR = path.join(DATA_DIR, 'sheet-backups');
const CONFIG = path.join(BACKUP_DIR, 'sheets.json');
const KEEP = 12;

// Stamp passed in (Date.* is fine in a plain script, but allow override for tests).
const stampArg = process.argv.indexOf('--stamp');
const STAMP = (stampArg !== -1 && process.argv[stampArg + 1] ? process.argv[stampArg + 1] : new Date().toISOString())
  .replace(/[:.]/g, '-');

interface SheetEntry {
  key: string;
  spreadsheetId: string;
  range?: string;
}

function loadConfig(): SheetEntry[] {
  if (!fs.existsSync(CONFIG)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.writeFileSync(
      CONFIG,
      JSON.stringify(
        [{ key: 'EXAMPLE-remove-me', spreadsheetId: 'SHEET_ID_HERE', range: "'Sheet1'!A:Z" }],
        null,
        2,
      ),
    );
    console.log(`OK: wrote starter config ${CONFIG} — edit it with real sheet IDs, then re-run.`);
    return [];
  }
  return (JSON.parse(fs.readFileSync(CONFIG, 'utf-8')) as SheetEntry[]).filter((e) => e.spreadsheetId && !e.key.startsWith('EXAMPLE'));
}

function backupOne(e: SheetEntry): { key: string; ok: boolean; rows?: number; err?: string } {
  const params: Record<string, string> = { spreadsheetId: e.spreadsheetId };
  if (e.range) params.range = e.range;
  // If no range given, fetch the spreadsheet metadata + first sheet's values.
  try {
    const args = e.range
      ? ['sheets', 'spreadsheets', 'values', 'get', '--params', JSON.stringify(params), '--format=json']
      : ['sheets', 'spreadsheets', 'get', '--params', JSON.stringify(params), '--format=json'];
    const out = execFileSync(GWS, args, { timeout: 60_000, maxBuffer: 32 * 1024 * 1024 }).toString();
    const dir = path.join(BACKUP_DIR, e.key);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${STAMP}.json`);
    fs.writeFileSync(file, out);
    // prune old snapshots
    const snaps = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort();
    for (const old of snaps.slice(0, Math.max(0, snaps.length - KEEP))) fs.rmSync(path.join(dir, old));
    let rows: number | undefined;
    try {
      rows = (JSON.parse(out).values || []).length;
    } catch {
      /* metadata form */
    }
    return { key: e.key, ok: true, rows };
  } catch (err) {
    return { key: e.key, ok: false, err: err instanceof Error ? err.message.slice(0, 200) : String(err) };
  }
}

function main(): void {
  const entries = loadConfig();
  if (entries.length === 0) {
    console.log('No sheets configured — nothing to back up.');
    return;
  }
  const results = entries.map(backupOne);
  for (const r of results) {
    console.log(`  ${r.ok ? 'OK ' : 'ERR'} ${r.key}${r.rows != null ? ` (${r.rows} rows)` : ''}${r.err ? ' — ' + r.err : ''}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`backup complete: ${results.length - failed}/${results.length} ok → ${BACKUP_DIR}`);
  process.exit(failed > 0 ? 1 : 0);
}

void os;
main();
