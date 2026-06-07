/**
 * Task DB helpers used by the scheduling module.
 *
 * Tasks are `messages_in` rows with `kind='task'`. This module doesn't own
 * its own table — it piggybacks on the core schema. That's why there's no
 * `module-scheduling-*.ts` migration file.
 *
 * cancel/pause/resume match any live row in the series, not just the exact id.
 * Recurring tasks get a new row per occurrence (see handleRecurrence), all
 * sharing series_id. Matching by id alone would only hit the completed row
 * the agent remembers, missing the live next occurrence.
 */
import type Database from 'better-sqlite3';

import { getDb } from '../../db/connection.js';
import { log } from '../../log.js';
import { nextEvenSeq } from '../../db/session-db.js';

/**
 * C5: append a row to the central task_audit_log. Best-effort for the task path
 * (matches v1) — a failed audit write must not break task scheduling, but is
 * logged loudly. Writes to the CENTRAL db (getDb), independent of the session
 * inbound.db the mutation operates on, so the trail survives session rotation.
 */
export function logTaskAudit(
  taskId: string,
  action: 'create' | 'update' | 'cancel' | 'pause' | 'resume',
  source: string,
  before: string | null,
  after: string | null,
): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO task_audit_log (timestamp, task_id, action, source, before_snapshot, after_snapshot)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(new Date().toISOString(), taskId, action, source, before, after);
  } catch (err) {
    log.error('task_audit_log write failed', { taskId, action, source, err });
  }
}

export function insertTask(
  db: Database.Database,
  task: {
    id: string;
    processAfter: string;
    recurrence: string | null;
    platformId: string | null;
    channelType: string | null;
    threadId: string | null;
    content: string;
  },
  source = 'ipc',
): void {
  db.prepare(
    `INSERT INTO messages_in (id, seq, timestamp, status, tries, process_after, recurrence, kind, platform_id, channel_type, thread_id, content, series_id)
     VALUES (@id, @seq, datetime('now'), 'pending', 0, @processAfter, @recurrence, 'task', @platformId, @channelType, @threadId, @content, @id)`,
  ).run({
    ...task,
    seq: nextEvenSeq(db),
  });
  logTaskAudit(
    task.id,
    'create',
    source,
    null,
    JSON.stringify({ content: task.content, recurrence: task.recurrence, processAfter: task.processAfter }),
  );
}

/** Snapshot the live rows a status transition is about to touch (for the audit before-image). */
function liveTaskStatuses(
  db: Database.Database,
  taskId: string,
  statuses: string[],
): Array<{ id: string; status: string }> {
  const placeholders = statuses.map(() => '?').join(', ');
  return db
    .prepare(
      `SELECT id, status FROM messages_in WHERE (id = ? OR series_id = ?) AND kind = 'task' AND status IN (${placeholders})`,
    )
    .all(taskId, taskId, ...statuses) as Array<{ id: string; status: string }>;
}

export function cancelTask(db: Database.Database, taskId: string, source = 'ipc'): void {
  const before = liveTaskStatuses(db, taskId, ['pending', 'paused']);
  const res = db
    .prepare(
      "UPDATE messages_in SET status = 'completed', recurrence = NULL WHERE (id = ? OR series_id = ?) AND kind = 'task' AND status IN ('pending', 'paused')",
    )
    .run(taskId, taskId);
  if (res.changes > 0) {
    logTaskAudit(taskId, 'cancel', source, JSON.stringify(before), JSON.stringify({ status: 'completed' }));
  }
}

export function pauseTask(db: Database.Database, taskId: string, source = 'ipc'): void {
  const before = liveTaskStatuses(db, taskId, ['pending']);
  const res = db
    .prepare(
      "UPDATE messages_in SET status = 'paused' WHERE (id = ? OR series_id = ?) AND kind = 'task' AND status = 'pending'",
    )
    .run(taskId, taskId);
  if (res.changes > 0) {
    logTaskAudit(taskId, 'pause', source, JSON.stringify(before), JSON.stringify({ status: 'paused' }));
  }
}

export function resumeTask(db: Database.Database, taskId: string, source = 'ipc'): void {
  const before = liveTaskStatuses(db, taskId, ['paused']);
  const res = db
    .prepare(
      "UPDATE messages_in SET status = 'pending' WHERE (id = ? OR series_id = ?) AND kind = 'task' AND status = 'paused'",
    )
    .run(taskId, taskId);
  if (res.changes > 0) {
    logTaskAudit(taskId, 'resume', source, JSON.stringify(before), JSON.stringify({ status: 'pending' }));
  }
}

export interface TaskUpdate {
  prompt?: string;
  script?: string | null;
  recurrence?: string | null;
  processAfter?: string;
}

// Merges content JSON in-place so callers can update prompt/script without
// clobbering other fields. Matches by id OR series_id so the live next
// occurrence of a recurring task is updated, not just the completed row the
// agent last saw. Returns the number of rows touched.
export function updateTask(db: Database.Database, taskId: string, update: TaskUpdate, source = 'ipc'): number {
  const rows = db
    .prepare(
      "SELECT id, content FROM messages_in WHERE (id = ? OR series_id = ?) AND kind = 'task' AND status IN ('pending', 'paused')",
    )
    .all(taskId, taskId) as Array<{ id: string; content: string }>;

  if (rows.length === 0) return 0;

  const setProcessAfter = update.processAfter !== undefined;
  const setRecurrence = update.recurrence !== undefined;
  const mergeContent = update.prompt !== undefined || update.script !== undefined;

  const tx = db.transaction(() => {
    for (const row of rows) {
      let content = row.content;
      if (mergeContent) {
        const parsed = JSON.parse(row.content) as Record<string, unknown>;
        if (update.prompt !== undefined) parsed.prompt = update.prompt;
        if (update.script !== undefined) parsed.script = update.script;
        content = JSON.stringify(parsed);
      }

      // Build SET clause dynamically so callers can update fields independently.
      const sets: string[] = ['content = ?'];
      const params: unknown[] = [content];
      if (setProcessAfter) {
        sets.push('process_after = ?');
        params.push(update.processAfter);
      }
      if (setRecurrence) {
        sets.push('recurrence = ?');
        params.push(update.recurrence);
      }
      params.push(row.id);

      db.prepare(`UPDATE messages_in SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }
  });
  tx();
  // updateTask only ever changes definition fields (prompt/script/recurrence/
  // process_after) — never incidental fields like last_run — so every call that
  // touches rows is a "significant" change worth auditing (v1's significant-
  // field guard existed to filter last_run noise, which doesn't apply here).
  logTaskAudit(taskId, 'update', source, JSON.stringify(rows), JSON.stringify(update));
  return rows.length;
}

export interface RecurringMessage {
  id: string;
  kind: string;
  content: string;
  recurrence: string;
  process_after: string | null;
  platform_id: string | null;
  channel_type: string | null;
  thread_id: string | null;
  series_id: string;
}

export function getCompletedRecurring(db: Database.Database): RecurringMessage[] {
  return db
    .prepare("SELECT * FROM messages_in WHERE status = 'completed' AND recurrence IS NOT NULL")
    .all() as RecurringMessage[];
}

export function insertRecurrence(
  db: Database.Database,
  msg: RecurringMessage,
  newId: string,
  nextRun: string | null,
): void {
  db.prepare(
    `INSERT INTO messages_in (id, seq, kind, timestamp, status, process_after, recurrence, platform_id, channel_type, thread_id, content, series_id)
     VALUES (?, ?, ?, datetime('now'), 'pending', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId,
    nextEvenSeq(db),
    msg.kind,
    nextRun,
    msg.recurrence,
    msg.platform_id,
    msg.channel_type,
    msg.thread_id,
    msg.content,
    msg.series_id,
  );
}

export function clearRecurrence(db: Database.Database, messageId: string): void {
  db.prepare('UPDATE messages_in SET recurrence = NULL WHERE id = ?').run(messageId);
}
