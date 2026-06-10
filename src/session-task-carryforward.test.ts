/**
 * C3 rotation orphan-fix — copyPendingTasks.
 *
 * When the drift safeguard rotates a session, its pending scheduled tasks live
 * in the *old* inbound.db, which the active-only host sweep never touches — so
 * recurring tasks (daily updates, reminders) silently stop firing. copyPendingTasks
 * carries the live task rows into the fresh session. These tests pin that behavior.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { ensureSchema, openInboundDb } from './db/session-db.js';
import { copyPendingTasks } from './session-manager.js';

const DIR = '/tmp/nanoclaw-carryforward-test';
const SRC = path.join(DIR, 'src-inbound.db');
const DST = path.join(DIR, 'dst-inbound.db');

let seqCounter = 0;
function seedTask(
  db: ReturnType<typeof openInboundDb>,
  opts: { id: string; status?: string; recurrence?: string | null; seriesId?: string; trigger?: number },
) {
  seqCounter += 2; // host writes even seq; keep each row's seq unique
  db.prepare(
    `INSERT INTO messages_in (id, seq, kind, timestamp, status, content, process_after, recurrence, series_id, trigger)
     VALUES (?, ?, 'task', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.id,
    seqCounter,
    '2026-06-09T10:00:00.000Z',
    opts.status ?? 'pending',
    JSON.stringify({ prompt: `task ${opts.id}` }),
    '2026-06-10T03:31:00.000Z',
    opts.recurrence ?? '31 6 * * 0-5',
    opts.seriesId ?? opts.id,
    opts.trigger ?? 1,
  );
}

beforeEach(() => {
  if (fs.existsSync(DIR)) fs.rmSync(DIR, { recursive: true });
  fs.mkdirSync(DIR, { recursive: true });
  ensureSchema(SRC, 'inbound');
  ensureSchema(DST, 'inbound');
});

afterEach(() => {
  if (fs.existsSync(DIR)) fs.rmSync(DIR, { recursive: true });
});

describe('copyPendingTasks', () => {
  it('carries pending + paused tasks forward, preserving id/series/recurrence', () => {
    const src = openInboundDb(SRC);
    seedTask(src, { id: 'task-daily', seriesId: 'series-root', recurrence: '31 6 * * 0-5' });
    seedTask(src, { id: 'task-paused', status: 'paused' });
    src.close();

    const dst = openInboundDb(DST);
    const carried = copyPendingTasks(openInboundDb(SRC), dst);
    expect(carried).toBe(2);

    const daily = dst.prepare("SELECT * FROM messages_in WHERE id = 'task-daily'").get() as Record<string, unknown>;
    expect(daily.status).toBe('pending');
    expect(daily.series_id).toBe('series-root');
    expect(daily.recurrence).toBe('31 6 * * 0-5');
    expect(daily.process_after).toBe('2026-06-10T03:31:00.000Z');
    expect((daily.seq as number) % 2).toBe(0); // host writes even seq
    dst.close();
  });

  it('does NOT carry completed or failed tasks (only live ones)', () => {
    const src = openInboundDb(SRC);
    seedTask(src, { id: 'task-done', status: 'completed' });
    seedTask(src, { id: 'task-failed', status: 'failed' });
    seedTask(src, { id: 'task-live', status: 'pending' });
    src.close();

    const dst = openInboundDb(DST);
    const carried = copyPendingTasks(openInboundDb(SRC), dst);
    expect(carried).toBe(1);
    expect(dst.prepare("SELECT id FROM messages_in WHERE id = 'task-live'").get()).toBeTruthy();
    expect(dst.prepare("SELECT id FROM messages_in WHERE id = 'task-done'").get()).toBeFalsy();
    dst.close();
  });

  it('is idempotent — re-running never double-inserts', () => {
    const src = openInboundDb(SRC);
    seedTask(src, { id: 'task-a' });
    src.close();

    const dst = openInboundDb(DST);
    expect(copyPendingTasks(openInboundDb(SRC), dst)).toBe(1);
    expect(copyPendingTasks(openInboundDb(SRC), dst)).toBe(0); // already present
    expect((dst.prepare("SELECT COUNT(*) AS n FROM messages_in WHERE id = 'task-a'").get() as { n: number }).n).toBe(1);
    dst.close();
  });

  it('returns 0 when the source has no live tasks', () => {
    const dst = openInboundDb(DST);
    expect(copyPendingTasks(openInboundDb(SRC), dst)).toBe(0);
    dst.close();
  });
});
