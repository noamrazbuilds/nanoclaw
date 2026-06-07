#!/usr/bin/env tsx
/**
 * One-off cutover helper: skip missed scheduled-task runs.
 *
 * After v1 was offline, migrated tasks have `process_after` in the past and
 * would all fire in a burst on v2 startup. This advances each overdue,
 * recurring task to its NEXT future cron occurrence (computed exactly like
 * src/modules/scheduling/recurrence.ts — cron-parser in TIMEZONE), so they
 * resume on schedule instead of replaying missed runs. One-shot tasks (no
 * recurrence) are left untouched.
 *
 * Usage: tsx scripts/reschedule-overdue-tasks.ts <inbound.db>
 */
import Database from 'better-sqlite3';
import { CronExpressionParser } from 'cron-parser';
import { TIMEZONE } from '../src/config.js';

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('Usage: tsx scripts/reschedule-overdue-tasks.ts <inbound.db>');
  process.exit(1);
}

const db = new Database(dbPath);
const now = new Date();
const tasks = db
  .prepare("SELECT id, process_after, recurrence FROM messages_in WHERE kind='task' AND status='pending'")
  .all() as Array<{ id: string; process_after: string; recurrence: string | null }>;

let advanced = 0;
let leftFuture = 0;
let oneShot = 0;
for (const t of tasks) {
  if (new Date(t.process_after) >= now) {
    leftFuture++;
    continue;
  }
  if (!t.recurrence) {
    oneShot++;
    console.log(`  (one-shot, left as-is overdue): ${t.id}`);
    continue;
  }
  const next = CronExpressionParser.parse(t.recurrence, { tz: TIMEZONE }).next().toISOString();
  db.prepare('UPDATE messages_in SET process_after = ? WHERE id = ?').run(next, t.id);
  console.log(`  ${t.id}: ${t.process_after} → ${next}  [${t.recurrence}]`);
  advanced++;
}
db.close();
console.log(`OK: advanced=${advanced}, left_future=${leftFuture}, one_shot_overdue=${oneShot}`);
