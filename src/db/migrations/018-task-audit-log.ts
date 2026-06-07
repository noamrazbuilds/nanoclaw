import type Database from 'better-sqlite3';
import type { Migration } from './index.js';

/**
 * C5: scheduled-task audit log (v1 parity). Append-only forensic trail of every
 * task-definition mutation (create / update / cancel / pause / resume) with
 * before/after snapshots and a source tag.
 *
 * Lives in the CENTRAL db (not a session inbound.db) deliberately: tasks +
 * recurrences outlive any single session, and C3 now rotates sessions every
 * 24h — a per-session audit would fragment across rotated session DBs and lose
 * the trail. Central keeps one durable, queryable history (the property the
 * 2026-05-18 incident relied on). Append-only; never UPDATE/DELETE from app code.
 *
 * Writer: logTaskAudit() in src/modules/scheduling/db.ts. The per-run tool-call
 * ledger that C6 consumes is a SEPARATE surface (outbound.db tool_calls), not
 * this table — this is task-definition changes only.
 */
export const migration018: Migration = {
  version: 18,
  name: 'task-audit-log',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE task_audit_log (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp       TEXT NOT NULL,
        task_id         TEXT NOT NULL,
        action          TEXT NOT NULL,
        source          TEXT NOT NULL,
        before_snapshot TEXT,
        after_snapshot  TEXT
      );
      CREATE INDEX idx_task_audit_task ON task_audit_log(task_id);
      CREATE INDEX idx_task_audit_ts ON task_audit_log(timestamp);
    `);
  },
};
