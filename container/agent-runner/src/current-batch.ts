/**
 * Per-batch context the poll loop publishes for downstream consumers
 * (MCP tools, etc.) that don't sit on the poll-loop's call stack.
 *
 * ⚠ CROSS-PROCESS: the nanoclaw MCP server (send_message / send_file /
 * generate_image) runs as a SEPARATE `bun` subprocess (see src/index.ts —
 * `nanoclaw: { command: 'bun', args: [...] }`), spawned by the agent SDK over
 * stdio. A plain module-level `let` set in the poll-loop process is therefore
 * invisible to the MCP handlers — they'd always read the default. That is the
 * 2026-06-11 bug: `suppress_chat_output` never suppressed intermediate
 * `send_message` calls (and `in_reply_to` was always null on tool-sent rows),
 * because both lived only in the poll-loop's memory.
 *
 * Fix: back this state with `session_state` in outbound.db, which BOTH processes
 * open (`getOutboundDb()`). The poll-loop writes; the MCP subprocess reads the
 * committed value. journal_mode=DELETE makes each commit immediately visible to
 * the other connection. The module-level mirror is kept as an in-process
 * fast-path/fallback (and so out-of-batch/test calls behave sanely when no row
 * exists yet).
 */
import { getOutboundDb } from './db/connection.js';

const SUPPRESS_KEY = 'runtime:suppress_chat_output';
const IN_REPLY_TO_KEY = 'runtime:in_reply_to';
const DELIVERED_KEY = 'runtime:messages_delivered_turn';

// In-process mirror — authoritative only within the writer (poll-loop) process;
// the subprocess relies entirely on the DB-backed value. Used as a fallback when
// the DB has no row yet or a read fails.
let suppressChatOutput = false;
let currentInReplyTo: string | null = null;
let messagesDelivered = 0;

function dbSet(key: string, value: string | null): void {
  try {
    const db = getOutboundDb();
    if (value === null) {
      db.prepare('DELETE FROM session_state WHERE key = ?').run(key);
    } else {
      db.prepare('INSERT OR REPLACE INTO session_state (key, value, updated_at) VALUES (?, ?, ?)').run(
        key,
        value,
        new Date().toISOString(),
      );
    }
  } catch {
    /* no DB yet (shouldn't happen in-container) — the in-process mirror still holds */
  }
}

function dbGet(key: string): string | undefined {
  try {
    const row = getOutboundDb().prepare('SELECT value FROM session_state WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  } catch {
    return undefined;
  }
}

export function setCurrentInReplyTo(id: string | null): void {
  currentInReplyTo = id;
  dbSet(IN_REPLY_TO_KEY, id);
}

export function clearCurrentInReplyTo(): void {
  currentInReplyTo = null;
  dbSet(IN_REPLY_TO_KEY, null);
}

export function getCurrentInReplyTo(): string | null {
  const v = dbGet(IN_REPLY_TO_KEY);
  return v !== undefined ? v : currentInReplyTo;
}

/**
 * C4 part 3: transitive output suppression. Set true while the runner is
 * processing a scheduled task whose content declares `suppress_chat_output`.
 * Consulted by every chat-emitting MCP tool (send_message / send_file /
 * generate_image) AND by the poll-loop's final-result dispatch, so a
 * fully-silent task (e.g. the daily update, delivered via email) emits NOTHING
 * to chat — not intermediate progress, not the final digest. Cleared after the
 * batch completes or errors. The honest-failure alert is deliberately NOT gated
 * by this — a task that lied about completing must still surface.
 */
export function setSuppressChatOutput(value: boolean): void {
  suppressChatOutput = value;
  dbSet(SUPPRESS_KEY, value ? '1' : '0');
}

export function getSuppressChatOutput(): boolean {
  const v = dbGet(SUPPRESS_KEY);
  if (v !== undefined) return v === '1';
  return suppressChatOutput;
}

/**
 * Per-turn counter of user-facing chat messages the agent has delivered via the
 * MCP tools (send_message / send_file) this turn. DB-backed because those tools
 * run in a SEPARATE subprocess (same cross-process reason as the suppress flag).
 *
 * Used by the poll-loop to kill a redundant SECOND message on SCHEDULED-TASK
 * turns: a task that already delivered its result via send_message would
 * otherwise ALSO get its final-turn assistant text dispatched (the agent's
 * "Triage sent. 5 items…" / a re-stated briefing → the 2026-06-22 double-send).
 * Reset at the start of each turn by the poll-loop.
 */
export function resetMessagesDelivered(): void {
  messagesDelivered = 0;
  dbSet(DELIVERED_KEY, '0');
}

export function incrementMessagesDelivered(): void {
  const current = getMessagesDelivered();
  messagesDelivered = current + 1;
  dbSet(DELIVERED_KEY, String(messagesDelivered));
}

export function getMessagesDelivered(): number {
  const v = dbGet(DELIVERED_KEY);
  if (v !== undefined) {
    const n = parseInt(v, 10);
    if (!Number.isNaN(n)) return n;
  }
  return messagesDelivered;
}
