/**
 * C6 tests — required-tools check logic + the host-side honest-failure backstop.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { getDb } from './db/connection.js';
import { initTestDb, closeDb, runMigrations } from './db/index.js';
import { ensureSchema, openInboundDb, openOutboundDbRw } from './db/session-db.js';
import { parseRequiredTools, unmetRequiredTools } from './required-tools.js';
import { runHonestFailureBackstop } from './modules/scheduling/honest-failure.js';

describe('unmetRequiredTools', () => {
  const calls = [
    { tool: 'mcp__gws__sheets_values_get', status: 'success' },
    { tool: 'mcp__gws__sheets_values_clear', status: 'failure' },
    { tool: 'Read', status: 'success' },
  ];

  it('returns [] when all requirements are met by successful calls', () => {
    expect(unmetRequiredTools(calls, [{ op_match: 'sheets_values_get' }])).toEqual([]);
  });

  it('flags a required tool that was never invoked', () => {
    expect(unmetRequiredTools(calls, [{ op_match: 'sheets_values_update' }])).toEqual(['sheets_values_update']);
  });

  it('does not count failed invocations toward min_success', () => {
    // clear was invoked but FAILED → still unmet
    expect(unmetRequiredTools(calls, [{ op_match: 'sheets_values_clear' }])).toEqual(['sheets_values_clear']);
  });

  it('honors min_success thresholds', () => {
    expect(unmetRequiredTools(calls, [{ op_match: 'sheets_values_get', min_success: 2 }])).toEqual([
      'sheets_values_get',
    ]);
  });

  it('supports regex matching', () => {
    expect(unmetRequiredTools(calls, [{ op_match: 'sheets_values_(get|update)', match: 'regex' }])).toEqual([]);
    expect(unmetRequiredTools(calls, [{ op_match: 'sheets_values_(clear|update)', match: 'regex' }])).toEqual([
      'sheets_values_(clear|update)',
    ]);
  });
});

describe('parseRequiredTools', () => {
  it('parses a declared required_tools array', () => {
    const out = parseRequiredTools(
      JSON.stringify({ prompt: 'x', required_tools: [{ op_match: 'a' }, { op_match: 'b' }] }),
    );
    expect(out.map((r) => r.op_match)).toEqual(['a', 'b']);
  });
  it('returns [] when absent (lenient) or malformed', () => {
    expect(parseRequiredTools(JSON.stringify({ prompt: 'x' }))).toEqual([]);
    expect(parseRequiredTools('not json')).toEqual([]);
    expect(parseRequiredTools(JSON.stringify({ required_tools: 'nope' }))).toEqual([]);
  });
});

describe('C6 host honest-failure backstop', () => {
  const DIR = '/tmp/nanoclaw-c6-test';
  const INBOUND = path.join(DIR, 'inbound.db');
  const OUTBOUND = path.join(DIR, 'outbound.db');
  const REQUIRED = [{ op_match: 'sheets_values_get', min_success: 1 }];

  function seedTask(opts: { withRequired: boolean }) {
    if (fs.existsSync(DIR)) fs.rmSync(DIR, { recursive: true });
    fs.mkdirSync(DIR, { recursive: true });
    ensureSchema(INBOUND, 'inbound');
    ensureSchema(OUTBOUND, 'outbound');
    const inDb = openInboundDb(INBOUND);
    const content = JSON.stringify({ prompt: 'concert', ...(opts.withRequired ? { required_tools: REQUIRED } : {}) });
    inDb
      .prepare(
        "INSERT INTO messages_in (id, seq, kind, timestamp, status, content) VALUES (?, 2, 'task', ?, 'completed', ?)",
      )
      .run('task-concert', '2026-06-07T00:00:00.000Z', content);
    const outDb = openOutboundDbRw(OUTBOUND);
    return { inDb, outDb };
  }

  function addCall(outDb: ReturnType<typeof openOutboundDbRw>, tool: string, status: string) {
    outDb
      .prepare('INSERT INTO tool_calls (tool, status, ts) VALUES (?, ?, ?)')
      .run(tool, status, '2026-06-07T01:00:00.000Z');
  }

  function honestFailures(): number {
    return (
      getDb()
        .prepare(
          "SELECT COUNT(*) AS n FROM task_audit_log WHERE task_id = 'task-concert' AND action = 'honest-failure'",
        )
        .get() as {
        n: number;
      }
    ).n;
  }

  beforeEach(() => {
    runMigrations(initTestDb());
  });
  afterEach(() => {
    closeDb();
    if (fs.existsSync(DIR)) fs.rmSync(DIR, { recursive: true });
  });

  it('records an honest-failure when a required tool was not invoked (the concert-incident case)', () => {
    const { inDb, outDb } = seedTask({ withRequired: true });
    addCall(outDb, 'Read', 'success'); // did some work but NOT the required sheets read
    runHonestFailureBackstop(inDb, outDb, ['task-concert']);
    inDb.close();
    outDb.close();
    expect(honestFailures()).toBe(1);
  });

  it('does not flag when the required tool was successfully invoked', () => {
    const { inDb, outDb } = seedTask({ withRequired: true });
    addCall(outDb, 'mcp__gws__sheets_values_get', 'success');
    runHonestFailureBackstop(inDb, outDb, ['task-concert']);
    inDb.close();
    outDb.close();
    expect(honestFailures()).toBe(0);
  });

  it('is lenient for tasks without a required_tools declaration', () => {
    const { inDb, outDb } = seedTask({ withRequired: false });
    runHonestFailureBackstop(inDb, outDb, ['task-concert']);
    inDb.close();
    outDb.close();
    expect(honestFailures()).toBe(0);
  });
});
