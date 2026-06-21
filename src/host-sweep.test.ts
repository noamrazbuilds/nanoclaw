/**
 * Unit tests for the stuck-container decision logic introduced by
 * ACTION-ITEMS item 9. Lives on the pure helper `decideStuckAction` so we
 * don't have to mock the filesystem or the container runner.
 */
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { deleteOrphanProcessingClaims, getProcessingClaims } from './db/session-db.js';
import {
  ABSOLUTE_CEILING_MS,
  CLAIM_STUCK_MS,
  IDLE_TIMEOUT_MS,
  PROCESS_DEAD_MS,
  _resetStuckProcessingRowsForTesting,
  decideStuckAction,
  decideStuckActionV2,
  parseSqliteUtc,
} from './host-sweep.js';
import type { Session } from './types.js';

const BASE = Date.parse('2026-04-20T12:00:00.000Z');

function claim(id: string, offsetMs: number) {
  return { message_id: id, status_changed: new Date(BASE - offsetMs).toISOString() };
}

describe('decideStuckAction', () => {
  it('returns ok when heartbeat is fresh and no claims', () => {
    expect(
      decideStuckAction({
        now: BASE,
        heartbeatMtimeMs: BASE - 5_000,
        containerState: null,
        claims: [],
      }),
    ).toEqual({ action: 'ok' });
  });

  it('returns kill-ceiling when heartbeat older than 30 min', () => {
    const heartbeatMtimeMs = BASE - ABSOLUTE_CEILING_MS - 1_000;
    const res = decideStuckAction({
      now: BASE,
      heartbeatMtimeMs,
      containerState: null,
      claims: [],
    });
    expect(res.action).toBe('kill-ceiling');
    if (res.action !== 'kill-ceiling') return;
    expect(res.ceilingMs).toBe(ABSOLUTE_CEILING_MS);
    expect(res.heartbeatAgeMs).toBeGreaterThan(ABSOLUTE_CEILING_MS);
  });

  it('skips the ceiling check when no heartbeat file exists (fresh container not yet ticked)', () => {
    // A freshly-spawned container hasn't produced any SDK events yet, so no
    // heartbeat. Prior behavior treated this as infinitely stale and killed
    // every container within seconds of spawn. With no claims either, we
    // should conclude everything is fine.
    const res = decideStuckAction({
      now: BASE,
      heartbeatMtimeMs: 0,
      containerState: null,
      claims: [],
    });
    expect(res.action).toBe('ok');
  });

  it('kills on claim-stuck when heartbeat is absent AND a claim has aged past tolerance', () => {
    // Hanging fresh container: spawned, picked up a message (claim recorded
    // in processing_ack), but never wrote a heartbeat. Falls through the
    // skipped ceiling check into claim-stuck — which correctly fires.
    const claimedAgeMs = CLAIM_STUCK_MS + 5_000;
    const res = decideStuckAction({
      now: BASE,
      heartbeatMtimeMs: 0,
      containerState: null,
      claims: [claim('msg-1', claimedAgeMs)],
    });
    expect(res.action).toBe('kill-claim');
  });

  it('extends the ceiling when Bash has a declared timeout longer than 30 min', () => {
    const twoHrMs = 2 * 60 * 60 * 1000;
    const res = decideStuckAction({
      now: BASE,
      // 45 min — over the default ceiling, but under the Bash timeout
      heartbeatMtimeMs: BASE - 45 * 60 * 1000,
      containerState: {
        current_tool: 'Bash',
        tool_declared_timeout_ms: twoHrMs,
        tool_started_at: new Date(BASE - 45 * 60 * 1000).toISOString(),
      },
      claims: [],
    });
    expect(res.action).toBe('ok');
  });

  it('returns kill-claim when a claim is past 60s and heartbeat has not moved', () => {
    const claimedAgeMs = CLAIM_STUCK_MS + 10_000;
    const res = decideStuckAction({
      now: BASE,
      heartbeatMtimeMs: BASE - claimedAgeMs - 5_000, // older than the claim
      containerState: null,
      claims: [claim('msg-1', claimedAgeMs)],
    });
    expect(res.action).toBe('kill-claim');
    if (res.action !== 'kill-claim') return;
    expect(res.messageId).toBe('msg-1');
    expect(res.toleranceMs).toBe(CLAIM_STUCK_MS);
  });

  it('does not kill when heartbeat has been touched since the claim', () => {
    const claimedAgeMs = CLAIM_STUCK_MS + 10_000;
    const res = decideStuckAction({
      now: BASE,
      heartbeatMtimeMs: BASE - 2_000, // fresh, updated after the claim
      containerState: null,
      claims: [claim('msg-1', claimedAgeMs)],
    });
    expect(res.action).toBe('ok');
  });

  it('does not kill when claim age is below tolerance', () => {
    const res = decideStuckAction({
      now: BASE,
      heartbeatMtimeMs: BASE - CLAIM_STUCK_MS - 10_000, // old, but claim is recent
      containerState: null,
      claims: [claim('msg-1', 5_000)],
    });
    expect(res.action).toBe('ok');
  });

  it('widens per-claim tolerance for a running Bash with long timeout', () => {
    const tenMinMs = 10 * 60 * 1000;
    const res = decideStuckAction({
      now: BASE,
      // 5 min since claim, over the 60s default but under the declared Bash timeout
      heartbeatMtimeMs: BASE - 5 * 60 * 1000 - 5_000,
      containerState: {
        current_tool: 'Bash',
        tool_declared_timeout_ms: tenMinMs,
        tool_started_at: new Date(BASE - 5 * 60 * 1000).toISOString(),
      },
      claims: [claim('msg-1', 5 * 60 * 1000)],
    });
    expect(res.action).toBe('ok');
  });

  it('ignores claims with unparseable timestamps', () => {
    const res = decideStuckAction({
      now: BASE,
      heartbeatMtimeMs: BASE - 5_000,
      containerState: null,
      claims: [{ message_id: 'x', status_changed: 'not-a-date' }],
    });
    expect(res.action).toBe('ok');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Two-signal liveness — decideStuckActionV2
//
// Signal 1 (.alive / aliveMtimeMs) = event loop alive. Signal 2 (.heartbeat /
// heartbeatMtimeMs) = SDK progress. A FRESH .alive must accompany the Signal-2
// cases below so the process-dead branch (checked first) doesn't preempt them.
// ─────────────────────────────────────────────────────────────────────────────
describe('decideStuckActionV2', () => {
  const FRESH = BASE - 1_000; // 1s ago — well within every threshold

  it('returns ok when both signals fresh and no claims', () => {
    expect(
      decideStuckActionV2({
        now: BASE,
        aliveMtimeMs: FRESH,
        heartbeatMtimeMs: FRESH,
        containerState: null,
        claims: [],
      }),
    ).toEqual({ action: 'ok' });
  });

  // ── 1. process-dead ──
  it('kills process-dead when .alive is stale (with no claim)', () => {
    const aliveMtimeMs = BASE - PROCESS_DEAD_MS - 1_000;
    const res = decideStuckActionV2({
      now: BASE,
      aliveMtimeMs,
      heartbeatMtimeMs: FRESH,
      containerState: null,
      claims: [],
    });
    expect(res.action).toBe('kill-process-dead');
    if (res.action !== 'kill-process-dead') return;
    expect(res.thresholdMs).toBe(PROCESS_DEAD_MS);
    expect(res.aliveAgeMs).toBeGreaterThan(PROCESS_DEAD_MS);
  });

  it('kills process-dead even when a claim is active', () => {
    const res = decideStuckActionV2({
      now: BASE,
      aliveMtimeMs: BASE - PROCESS_DEAD_MS - 1_000,
      heartbeatMtimeMs: FRESH,
      containerState: null,
      claims: [claim('m', 5_000)],
    });
    expect(res.action).toBe('kill-process-dead');
  });

  it('process-dead WINS over sdk-hung (ordering): both stale + a claim → process-dead', () => {
    const res = decideStuckActionV2({
      now: BASE,
      aliveMtimeMs: BASE - PROCESS_DEAD_MS - 1_000,
      heartbeatMtimeMs: BASE - ABSOLUTE_CEILING_MS - 1_000,
      containerState: null,
      claims: [claim('m', ABSOLUTE_CEILING_MS + 5_000)],
    });
    expect(res.action).toBe('kill-process-dead');
  });

  it('fresh-spawn grace: aliveMtimeMs=0 never trips process-dead', () => {
    const res = decideStuckActionV2({
      now: BASE,
      aliveMtimeMs: 0,
      heartbeatMtimeMs: FRESH,
      containerState: null,
      claims: [],
    });
    expect(res.action).toBe('ok');
  });

  it('does not kill process-dead when .alive is fresh', () => {
    const res = decideStuckActionV2({
      now: BASE,
      aliveMtimeMs: FRESH,
      heartbeatMtimeMs: FRESH,
      containerState: null,
      claims: [],
    });
    expect(res.action).toBe('ok');
  });

  // ── 2. sdk-hung (gated on an active claim) ──
  it('kills sdk-hung when a task is claimed and heartbeat older than the ceiling', () => {
    const res = decideStuckActionV2({
      now: BASE,
      aliveMtimeMs: FRESH, // process alive — only the SDK is stuck
      heartbeatMtimeMs: BASE - ABSOLUTE_CEILING_MS - 1_000,
      containerState: null,
      claims: [claim('m', 30_000)], // claim younger than ceiling so claim-stuck wouldn't fire first
    });
    expect(res.action).toBe('kill-sdk-hung');
    if (res.action !== 'kill-sdk-hung') return;
    expect(res.ceilingMs).toBe(ABSOLUTE_CEILING_MS);
  });

  it('does NOT kill sdk-hung when there is no active claim (idle container survives SDK-staleness)', () => {
    // Same stale heartbeat, but no claim and heartbeat age < IDLE_TIMEOUT → ok.
    const res = decideStuckActionV2({
      now: BASE,
      aliveMtimeMs: FRESH,
      heartbeatMtimeMs: BASE - ABSOLUTE_CEILING_MS - 1_000,
      containerState: null,
      claims: [],
    });
    expect(res.action).toBe('ok');
  });

  it('extends the sdk-hung ceiling when Bash declares a longer timeout', () => {
    const longBash = ABSOLUTE_CEILING_MS + 30 * 60 * 1000;
    const res = decideStuckActionV2({
      now: BASE,
      aliveMtimeMs: FRESH,
      heartbeatMtimeMs: BASE - ABSOLUTE_CEILING_MS - 60_000, // past base ceiling but within declared Bash
      containerState: { current_tool: 'Bash', tool_declared_timeout_ms: longBash } as never,
      claims: [claim('m', 30_000)],
    });
    expect(res.action).toBe('ok');
  });

  // ── 3. claim-stuck (unchanged semantics) ──
  it('kills claim-stuck when a claim is past tolerance and heartbeat has not moved since', () => {
    const res = decideStuckActionV2({
      now: BASE,
      aliveMtimeMs: FRESH, // alive, so process-dead doesn't preempt
      heartbeatMtimeMs: BASE - 5 * 60 * 1000, // before the claim
      containerState: null,
      claims: [claim('m', CLAIM_STUCK_MS + 5_000)],
    });
    expect(res.action).toBe('kill-claim');
  });

  it('does not kill claim-stuck when heartbeat moved after the claim', () => {
    const res = decideStuckActionV2({
      now: BASE,
      aliveMtimeMs: FRESH,
      heartbeatMtimeMs: BASE - 2_000, // after the claim
      containerState: null,
      claims: [claim('m', CLAIM_STUCK_MS + 5_000)],
    });
    expect(res.action).toBe('ok');
  });

  // ── 4. idle-timeout ──
  it('kills idle-timeout when unclaimed and last SDK event older than IDLE_TIMEOUT_MS', () => {
    const res = decideStuckActionV2({
      now: BASE,
      aliveMtimeMs: FRESH, // process alive & idle
      heartbeatMtimeMs: BASE - IDLE_TIMEOUT_MS - 1_000,
      containerState: null,
      claims: [],
    });
    expect(res.action).toBe('kill-idle');
    if (res.action !== 'kill-idle') return;
    expect(res.thresholdMs).toBe(IDLE_TIMEOUT_MS);
  });

  it('keeps an idle container WARM between the ceiling and the idle timeout (the headline win)', () => {
    // Heartbeat older than the (legacy) ABSOLUTE_CEILING_MS but younger than
    // IDLE_TIMEOUT_MS, no claim → legacy would kill-ceiling; V2 leaves it alone.
    const res = decideStuckActionV2({
      now: BASE,
      aliveMtimeMs: FRESH,
      heartbeatMtimeMs: BASE - ABSOLUTE_CEILING_MS - 60_000,
      containerState: null,
      claims: [],
    });
    expect(res.action).toBe('ok');
  });

  it('never reaps a never-worked fresh container via idle (heartbeatMtimeMs=0, no claim)', () => {
    const res = decideStuckActionV2({
      now: BASE,
      aliveMtimeMs: FRESH,
      heartbeatMtimeMs: 0,
      containerState: null,
      claims: [],
    });
    expect(res.action).toBe('ok');
  });

  it('idle-timeout does not fire while a claim is active (mutual exclusion with sdk-hung)', () => {
    const res = decideStuckActionV2({
      now: BASE,
      aliveMtimeMs: FRESH,
      heartbeatMtimeMs: BASE - IDLE_TIMEOUT_MS - 1_000,
      containerState: null,
      claims: [claim('m', 30_000)],
    });
    // With a claim + heartbeat well past the ceiling → sdk-hung, not idle.
    expect(res.action).toBe('kill-sdk-hung');
  });

  // ── V2 ⊇ legacy (the load-bearing shadow-migration invariant) ──
  it('V2 kills wherever legacy kill-ceiling fires (maps to sdk-hung when claimed)', () => {
    const heartbeatMtimeMs = BASE - ABSOLUTE_CEILING_MS - 1_000;
    const legacyArgs = { now: BASE, heartbeatMtimeMs, containerState: null, claims: [claim('m', 30_000)] };
    expect(decideStuckAction(legacyArgs).action).toBe('kill-ceiling');
    expect(decideStuckActionV2({ ...legacyArgs, aliveMtimeMs: FRESH }).action).toBe('kill-sdk-hung');
  });

  it('V2 kills wherever legacy kill-ceiling fires (maps to idle when unclaimed past idle timeout)', () => {
    const heartbeatMtimeMs = BASE - IDLE_TIMEOUT_MS - 1_000;
    const legacyArgs = { now: BASE, heartbeatMtimeMs, containerState: null, claims: [] };
    expect(decideStuckAction(legacyArgs).action).toBe('kill-ceiling');
    expect(decideStuckActionV2({ ...legacyArgs, aliveMtimeMs: FRESH }).action).toBe('kill-idle');
  });

  it('V2 kills wherever legacy kill-claim fires (same claim-stuck branch)', () => {
    const legacyArgs = {
      now: BASE,
      heartbeatMtimeMs: BASE - 5 * 60 * 1000,
      containerState: null,
      claims: [claim('m', CLAIM_STUCK_MS + 5_000)],
    };
    expect(decideStuckAction(legacyArgs).action).toBe('kill-claim');
    expect(decideStuckActionV2({ ...legacyArgs, aliveMtimeMs: FRESH }).action).toBe('kill-claim');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Orphan claim cleanup (regression test for the SIGKILL → claim-stuck loop)
//
// Repro of the production bug seen 2026-04-30: container A claimed message M
// (writes processing_ack row with status='processing'). Host kills A by
// absolute-ceiling. Old behavior: messages_in.M was reset to pending but
// processing_ack.M survived. On the next sweep tick, wakeContainer spawned B,
// the same-tick SLA check saw M's stale claim age (hours), and SIGKILL'd B
// before agent-runner could run clearStaleProcessingAcks(). Loop. The fix
// deletes processing_ack 'processing' rows when the host kills/cleans the
// container, breaking the loop atomically.
// ─────────────────────────────────────────────────────────────────────────────

function makeSessionDbs(): { inDb: Database.Database; outDb: Database.Database } {
  const inDb = new Database(':memory:');
  inDb.exec(`
    CREATE TABLE messages_in (
      id            TEXT PRIMARY KEY,
      seq           INTEGER UNIQUE,
      kind          TEXT NOT NULL,
      timestamp     TEXT NOT NULL,
      status        TEXT DEFAULT 'pending',
      process_after TEXT,
      recurrence    TEXT,
      series_id     TEXT,
      tries         INTEGER DEFAULT 0,
      trigger       INTEGER NOT NULL DEFAULT 1,
      platform_id   TEXT,
      channel_type  TEXT,
      thread_id     TEXT,
      content       TEXT NOT NULL
    );
  `);
  const outDb = new Database(':memory:');
  outDb.exec(`
    CREATE TABLE processing_ack (
      message_id     TEXT PRIMARY KEY,
      status         TEXT NOT NULL,
      status_changed TEXT NOT NULL
    );
  `);
  return { inDb, outDb };
}

function fakeSession(): Session {
  return {
    id: 'sess-test',
    agent_group_id: 'ag-test',
    messaging_group_id: null,
    thread_id: null,
    agent_provider: null,
    status: 'active',
    container_status: 'stopped',
    last_active: null,
    created_at: new Date().toISOString(),
    skills_hash: '',
  };
}

describe('deleteOrphanProcessingClaims', () => {
  it('removes only processing rows, leaves completed/failed alone', () => {
    const { outDb } = makeSessionDbs();
    const ts = new Date().toISOString();
    outDb.prepare("INSERT INTO processing_ack VALUES ('m-proc', 'processing', ?)").run(ts);
    outDb.prepare("INSERT INTO processing_ack VALUES ('m-done', 'completed', ?)").run(ts);
    outDb.prepare("INSERT INTO processing_ack VALUES ('m-fail', 'failed', ?)").run(ts);

    const removed = deleteOrphanProcessingClaims(outDb);

    expect(removed).toBe(1);
    const remaining = outDb.prepare('SELECT message_id, status FROM processing_ack ORDER BY message_id').all();
    expect(remaining).toEqual([
      { message_id: 'm-done', status: 'completed' },
      { message_id: 'm-fail', status: 'failed' },
    ]);
  });

  it('returns 0 when nothing to clear', () => {
    const { outDb } = makeSessionDbs();
    expect(deleteOrphanProcessingClaims(outDb)).toBe(0);
  });
});

describe('resetStuckProcessingRows — orphan claim cleanup', () => {
  it('deletes orphan processing_ack rows so next sweep tick does not see them', () => {
    const { inDb, outDb } = makeSessionDbs();
    const claimedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2h ago

    // messages_in.status stays 'pending' during processing — only the
    // container's processing_ack moves to 'processing'. See
    // src/db/schema.ts header comment on processing_ack.
    inDb
      .prepare(
        "INSERT INTO messages_in (id, seq, kind, timestamp, status, content) VALUES ('m-1', 1, 'chat', ?, 'pending', '{}')",
      )
      .run(claimedAt);
    outDb.prepare("INSERT INTO processing_ack VALUES ('m-1', 'processing', ?)").run(claimedAt);

    // Sanity: the orphan claim is what would trip claim-stuck.
    expect(getProcessingClaims(outDb)).toHaveLength(1);

    _resetStuckProcessingRowsForTesting(inDb, outDb, fakeSession(), 'absolute-ceiling');

    // Regression assertion: orphan claim is gone — next sweep tick will see
    // an empty claims list and not kill the freshly respawned container.
    expect(getProcessingClaims(outDb)).toEqual([]);

    // And the message itself was rescheduled with backoff (existing behavior).
    const row = inDb.prepare('SELECT status, tries, process_after FROM messages_in WHERE id = ?').get('m-1') as {
      status: string;
      tries: number;
      process_after: string | null;
    };
    expect(row.status).toBe('pending');
    expect(row.tries).toBe(1);
    expect(row.process_after).not.toBeNull();
  });

  it('still clears orphan claims even when the inbound message has already been retried (skip path)', () => {
    // Edge case: the inbound row was already rescheduled (process_after in
    // future), so the per-message retry loop skips it. The orphan in
    // processing_ack must still be removed — otherwise the bug remains.
    const { inDb, outDb } = makeSessionDbs();
    const claimedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();

    inDb
      .prepare(
        "INSERT INTO messages_in (id, seq, kind, timestamp, status, process_after, tries, content) VALUES ('m-2', 2, 'chat', ?, 'pending', ?, 1, '{}')",
      )
      .run(claimedAt, future);
    outDb.prepare("INSERT INTO processing_ack VALUES ('m-2', 'processing', ?)").run(claimedAt);

    _resetStuckProcessingRowsForTesting(inDb, outDb, fakeSession(), 'claim-stuck');

    expect(getProcessingClaims(outDb)).toEqual([]);
    const row = inDb.prepare('SELECT tries FROM messages_in WHERE id = ?').get('m-2') as { tries: number };
    expect(row.tries).toBe(1); // not bumped, the skip path held
  });
});

describe('parseSqliteUtc', () => {
  // Regression: SQLite TIMESTAMP strings have no zone marker, but Date.parse
  // treats those as local time. On non-UTC hosts this made every claim look
  // (TZ offset) hours stale and tripped kill-claim on freshly-claimed messages.
  // The helper appends "Z" only when no marker is present, so parsing is
  // always anchored to UTC regardless of host timezone.

  const utcMs = Date.parse('2026-04-20T12:00:00.000Z');

  it('treats a SQLite-style timestamp (no zone) as UTC', () => {
    expect(parseSqliteUtc('2026-04-20 12:00:00')).toBe(utcMs);
    expect(parseSqliteUtc('2026-04-20T12:00:00')).toBe(utcMs);
    expect(parseSqliteUtc('2026-04-20T12:00:00.000')).toBe(utcMs);
  });

  it('preserves an explicit Z marker', () => {
    expect(parseSqliteUtc('2026-04-20T12:00:00.000Z')).toBe(utcMs);
    expect(parseSqliteUtc('2026-04-20T12:00:00z')).toBe(utcMs);
  });

  it('preserves an explicit numeric offset', () => {
    // 14:00+02:00 == 12:00 UTC
    expect(parseSqliteUtc('2026-04-20T14:00:00+02:00')).toBe(utcMs);
    expect(parseSqliteUtc('2026-04-20T14:00:00+0200')).toBe(utcMs);
    // 07:00-05:00 == 12:00 UTC
    expect(parseSqliteUtc('2026-04-20T07:00:00-05:00')).toBe(utcMs);
  });

  it('returns NaN for unparseable input', () => {
    expect(Number.isNaN(parseSqliteUtc('not a date'))).toBe(true);
  });

  it('does not drift across host timezones for SQLite-style input', () => {
    // The helper itself is timezone-independent because it forces UTC parsing.
    // (Verifying the regex branch — without the helper, `Date.parse` of the
    // bare string returns different values depending on the host TZ.)
    const bare = '2026-04-20T12:00:00';
    expect(parseSqliteUtc(bare)).toBe(Date.parse(bare + 'Z'));
  });
});
