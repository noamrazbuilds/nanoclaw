import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { drainAgentEvents } from './host-sweep.js';

// Mirrors the relevant slices of OUTBOUND_SCHEMA / INBOUND_SCHEMA. The drain
// itself creates the cursor table forward-compat, so we only seed agent_events.
function makeDbs(): { inDb: Database.Database; outDb: Database.Database; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-events-'));
  const inDb = new Database(path.join(dir, 'inbound.db'));
  const outDb = new Database(path.join(dir, 'outbound.db'));
  outDb.exec(
    `CREATE TABLE agent_events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, level TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT)`,
  );
  return { inDb, outDb, dir };
}

function emit(outDb: Database.Database, level: string, kind: string, detail: string): void {
  outDb
    .prepare(`INSERT INTO agent_events (ts, level, kind, detail) VALUES (?, ?, ?, ?)`)
    .run(new Date().toISOString(), level, kind, detail);
}

describe('drainAgentEvents', () => {
  let inDb: Database.Database;
  let outDb: Database.Database;
  let dir: string;
  const session = { id: 'sess-test' };

  beforeEach(() => {
    ({ inDb, outDb, dir } = makeDbs());
  });
  afterEach(() => {
    inDb.close();
    outDb.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('drains new events once and advances the cursor', () => {
    emit(outDb, 'error', 'credit_exhausted', 'Credit balance is too low');
    emit(outDb, 'warn', 'policy_refusal', 'unable to respond to this request');

    const first = drainAgentEvents(inDb, outDb, session, 'ag-test');
    expect(first.map((e) => e.kind)).toEqual(['credit_exhausted', 'policy_refusal']);

    // Re-draining without new events yields nothing (exactly-once).
    expect(drainAgentEvents(inDb, outDb, session, 'ag-test')).toEqual([]);

    // A new event after the cursor is drained on its own.
    emit(outDb, 'error', 'query_error', 'boom');
    const third = drainAgentEvents(inDb, outDb, session, 'ag-test');
    expect(third).toHaveLength(1);
    expect(third[0].kind).toBe('query_error');
  });

  it('returns [] when the agent_events table is absent (older outbound.db)', () => {
    const bare = new Database(path.join(dir, 'bare.db'));
    try {
      expect(drainAgentEvents(inDb, bare, session, 'ag-test')).toEqual([]);
    } finally {
      bare.close();
    }
  });
});
