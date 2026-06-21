import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { DATA_DIR } from './config.js';
import {
  initTestDb,
  closeDb,
  runMigrations,
  createAgentGroup,
  createSession,
  getSession,
  getActiveSessions,
} from './db/index.js';
import { reusableSession, rotateStaleSessionIfNeeded } from './session-manager.js';
import { computeSkillsHash } from './skills-hash.js';
import type { Session } from './types.js';

const HOUR = 3_600_000;

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    agent_group_id: 'ag-1',
    messaging_group_id: null,
    thread_id: null,
    agent_provider: null,
    status: 'active',
    container_status: 'stopped',
    last_active: null,
    created_at: new Date().toISOString(),
    skills_hash: '',
    ...overrides,
  };
}

beforeEach(() => {
  const db = initTestDb();
  runMigrations(db);
  createAgentGroup({ id: 'ag-1', name: 'A', folder: 'a', agent_provider: null, created_at: new Date().toISOString() });
});

afterEach(() => closeDb());

describe('C3 agent-drift safeguard — reusableSession', () => {
  it('reuses a fresh session whose skills hash matches', () => {
    const hash = computeSkillsHash();
    const s = makeSession({ skills_hash: hash });
    createSession(s);
    expect(reusableSession(s, hash)).toBe(true);
    expect(getSession(s.id)!.status).toBe('active');
  });

  it('keeps a session at 23h (under the 24h cap)', () => {
    const hash = computeSkillsHash();
    const s = makeSession({
      id: 'sess-23h',
      created_at: new Date(Date.now() - 23 * HOUR).toISOString(),
      skills_hash: hash,
    });
    createSession(s);
    expect(reusableSession(s, hash)).toBe(true);
  });

  it('invalidates a session older than 24h and marks it closed (reason=age)', () => {
    const hash = computeSkillsHash();
    const s = makeSession({
      id: 'sess-old',
      created_at: new Date(Date.now() - 25 * HOUR).toISOString(),
      skills_hash: hash,
    });
    createSession(s);
    expect(reusableSession(s, hash)).toBe(false);
    expect(getSession('sess-old')!.status).toBe('closed');
  });

  it('invalidates when the skills hash changed and marks it closed (reason=skills_changed)', () => {
    const s = makeSession({ id: 'sess-stale-skills', skills_hash: 'deadbeefdeadbeef' });
    createSession(s);
    expect(reusableSession(s, computeSkillsHash())).toBe(false);
    expect(getSession('sess-stale-skills')!.status).toBe('closed');
  });

  it('treats a pre-migration empty hash as stale when real skills exist', () => {
    const real = computeSkillsHash();
    // Only meaningful when the repo's container/skills/ dir produces a hash.
    if (!real) return;
    const s = makeSession({ id: 'sess-empty-hash', skills_hash: '' });
    createSession(s);
    expect(reusableSession(s, real)).toBe(false);
    expect(getSession('sess-empty-hash')!.status).toBe('closed');
  });
});

describe('host-sweep rotation — rotateStaleSessionIfNeeded', () => {
  // rotateStaleSessionIfNeeded creates real session folders under DATA_DIR; clean them.
  afterEach(() => {
    fs.rmSync(path.join(DATA_DIR, 'v2-sessions', 'ag-1'), { recursive: true, force: true });
  });

  it('returns null and leaves a fresh session untouched', () => {
    const hash = computeSkillsHash();
    const s = makeSession({ id: 'sess-fresh', skills_hash: hash });
    createSession(s);
    expect(rotateStaleSessionIfNeeded(s)).toBeNull();
    expect(getSession('sess-fresh')!.status).toBe('active');
  });

  it('rotates an aged session: successor active (routing preserved), predecessor closed, single active', () => {
    const hash = computeSkillsHash();
    const s = makeSession({
      id: 'sess-old',
      created_at: new Date(Date.now() - 25 * HOUR).toISOString(),
      skills_hash: hash,
    });
    createSession(s);

    const successor = rotateStaleSessionIfNeeded(s);
    expect(successor).not.toBeNull();
    // predecessor retired, successor active with the SAME routing + fresh hash
    expect(getSession('sess-old')!.status).toBe('closed');
    expect(successor!.status).toBe('active');
    expect(successor!.id).not.toBe('sess-old');
    expect(successor!.agent_group_id).toBe('ag-1');
    expect(successor!.messaging_group_id).toBe(s.messaging_group_id);
    expect(successor!.thread_id).toBe(s.thread_id);
    expect(successor!.skills_hash).toBe(hash);
    // exactly one active session for this agent group after rotation (no duplicate)
    expect(getActiveSessions().filter((x) => x.agent_group_id === 'ag-1').length).toBe(1);
  });

  it('rotates on a skills-hash change even when the session is young', () => {
    const s = makeSession({ id: 'sess-skills', skills_hash: 'deadbeefdeadbeef' });
    createSession(s);
    const successor = rotateStaleSessionIfNeeded(s);
    expect(successor).not.toBeNull();
    expect(getSession('sess-skills')!.status).toBe('closed');
    expect(successor!.skills_hash).toBe(computeSkillsHash());
  });
});

describe('computeSkillsHash', () => {
  it('is deterministic across calls (order-independent)', () => {
    expect(computeSkillsHash()).toBe(computeSkillsHash());
  });

  it('returns a 16-char hex digest (or empty when no skills dir)', () => {
    expect(computeSkillsHash()).toMatch(/^([0-9a-f]{16})?$/);
  });
});
