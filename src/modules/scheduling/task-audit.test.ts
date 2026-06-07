/**
 * C5 tests — scheduled-task audit log (central) + tool-call ledger reader.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { getDb } from '../../db/connection.js';
import { initTestDb, closeDb, runMigrations } from '../../db/index.js';
import { ensureSchema, openInboundDb, openOutboundDbRw, getToolCalls } from '../../db/session-db.js';
import { insertTask, updateTask, cancelTask, pauseTask, resumeTask } from './db.js';

const TEST_DIR = '/tmp/nanoclaw-task-audit-test';
const INBOUND = path.join(TEST_DIR, 'inbound.db');
const OUTBOUND = path.join(TEST_DIR, 'outbound.db');

function freshInbound() {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
  ensureSchema(INBOUND, 'inbound');
  return openInboundDb(INBOUND);
}

function basicTask(db: ReturnType<typeof openInboundDb>, id: string) {
  insertTask(db, {
    id,
    processAfter: new Date().toISOString(),
    recurrence: null,
    platformId: null,
    channelType: null,
    threadId: null,
    content: JSON.stringify({ prompt: 'noop' }),
  });
}

interface AuditRow {
  task_id: string;
  action: string;
  source: string;
  before_snapshot: string | null;
  after_snapshot: string | null;
}
function audits(taskId: string): AuditRow[] {
  return getDb()
    .prepare(
      'SELECT task_id, action, source, before_snapshot, after_snapshot FROM task_audit_log WHERE task_id = ? ORDER BY id',
    )
    .all(taskId) as AuditRow[];
}

beforeEach(() => {
  const db = initTestDb();
  runMigrations(db); // central DB incl. task_audit_log (migration 018)
});

afterEach(() => {
  closeDb();
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

describe('C5 task_audit_log', () => {
  it('logs create with an after-snapshot and default source=ipc', () => {
    const db = freshInbound();
    basicTask(db, 't1');
    db.close();
    const rows = audits('t1');
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('create');
    expect(rows[0].source).toBe('ipc');
    expect(rows[0].before_snapshot).toBeNull();
    expect(JSON.parse(rows[0].after_snapshot!).content).toContain('noop');
  });

  it('logs update with before + after snapshots', () => {
    const db = freshInbound();
    basicTask(db, 't2');
    updateTask(db, 't2', { prompt: 'updated' }, 'manual:claude-code');
    db.close();
    const rows = audits('t2');
    expect(rows.map((r) => r.action)).toEqual(['create', 'update']);
    const upd = rows[1];
    expect(upd.source).toBe('manual:claude-code');
    expect(upd.before_snapshot).toContain('noop');
    expect(JSON.parse(upd.after_snapshot!).prompt).toBe('updated');
  });

  it('logs pause → resume → cancel transitions', () => {
    const db = freshInbound();
    basicTask(db, 't3');
    pauseTask(db, 't3');
    resumeTask(db, 't3');
    cancelTask(db, 't3');
    db.close();
    expect(audits('t3').map((r) => r.action)).toEqual(['create', 'pause', 'resume', 'cancel']);
  });

  it('does not log a transition that touches no rows', () => {
    const db = freshInbound();
    basicTask(db, 't4');
    resumeTask(db, 't4'); // task is 'pending', not 'paused' → no-op
    db.close();
    expect(audits('t4').map((r) => r.action)).toEqual(['create']); // no spurious 'resume'
  });
});

describe('C5 tool-call ledger reader (getToolCalls)', () => {
  function seedOutbound(): ReturnType<typeof openOutboundDbRw> {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
    ensureSchema(OUTBOUND, 'outbound'); // creates tool_calls
    const db = openOutboundDbRw(OUTBOUND);
    const ins = db.prepare('INSERT INTO tool_calls (tool, status, ts) VALUES (?, ?, ?)');
    ins.run('Read', 'success', '2026-06-07T01:00:00.000Z');
    ins.run('mcp__gws__sheets_clear', 'success', '2026-06-07T02:00:00.000Z');
    ins.run('mcp__gws__sheets_clear', 'failure', '2026-06-07T03:00:00.000Z');
    return db;
  }

  it('reads all rows in order', () => {
    const db = seedOutbound();
    const all = getToolCalls(db);
    db.close();
    expect(all.map((r) => `${r.tool}:${r.status}`)).toEqual([
      'Read:success',
      'mcp__gws__sheets_clear:success',
      'mcp__gws__sheets_clear:failure',
    ]);
  });

  it('scopes to a time window (for C6 per-run filtering)', () => {
    const db = seedOutbound();
    const windowed = getToolCalls(db, { since: '2026-06-07T01:30:00.000Z', until: '2026-06-07T02:30:00.000Z' });
    db.close();
    expect(windowed).toHaveLength(1);
    expect(windowed[0].tool).toBe('mcp__gws__sheets_clear');
    expect(windowed[0].status).toBe('success');
  });

  it('returns [] when the table is absent (older session DB)', () => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
    const bare = openOutboundDbRw(path.join(TEST_DIR, 'bare.db'));
    bare.exec('CREATE TABLE messages_out (id TEXT)'); // outbound.db without tool_calls
    expect(getToolCalls(bare)).toEqual([]);
    bare.close();
  });
});
