// Re-grade arena sessions currently marked 'failed'.
// Run: npx tsx scripts/regrade-failed-arena-sessions.ts [session_id ...]
//
// With no args, re-grades every session with grading_status='failed'.
// With args, re-grades only the listed session_ids.

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

import { initArenaDb } from '../src/arena/arena-db.js';
import { gradeOneSession } from '../src/arena/arena-grader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_DIR = process.env.STORE_DIR || path.join(process.cwd(), 'store');
const dbPath = path.join(STORE_DIR, 'messages.db');

const db = new Database(dbPath);
initArenaDb(db);

const explicit = process.argv.slice(2);
const sessions = explicit.length
  ? explicit
  : (
      db
        .prepare(
          `SELECT session_id FROM arena_sessions WHERE grading_status = 'failed' ORDER BY timestamp`,
        )
        .all() as Array<{ session_id: string }>
    ).map((r) => r.session_id);

if (sessions.length === 0) {
  console.log('No failed sessions to re-grade');
  process.exit(0);
}

console.log(`Re-grading ${sessions.length} session(s)...`);

let graded = 0;
let failed = 0;
for (const sessionId of sessions) {
  process.stdout.write(`  ${sessionId} ... `);
  try {
    const result = await gradeOneSession(sessionId);
    console.log(result);
    if (result === 'graded') graded++;
    else failed++;
  } catch (err) {
    console.log(`error: ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

console.log(`\nDone. graded=${graded} failed=${failed}`);
db.close();
