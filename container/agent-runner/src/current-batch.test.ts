import { beforeEach, afterEach, describe, expect, test } from 'bun:test';

import { initTestSessionDb, closeSessionDb } from './db/connection.js';
import {
  resetMessagesDelivered,
  incrementMessagesDelivered,
  getMessagesDelivered,
} from './current-batch.js';

beforeEach(() => initTestSessionDb());
afterEach(() => closeSessionDb());

// The counter is the cross-process signal behind the durable double-message
// guard: send_message/send_file (a separate subprocess) increment it; the
// poll-loop reads it to decide whether a task's trailing final-turn text is a
// redundant second message. It must be DB-backed (session_state), not just an
// in-process let, or the subprocess increments would be invisible.
describe('messages-delivered counter', () => {
  test('reset → 0', () => {
    incrementMessagesDelivered();
    resetMessagesDelivered();
    expect(getMessagesDelivered()).toBe(0);
  });

  test('increments accumulate', () => {
    resetMessagesDelivered();
    incrementMessagesDelivered();
    incrementMessagesDelivered();
    expect(getMessagesDelivered()).toBe(2);
  });

  test('value is persisted to session_state (visible cross-process)', () => {
    resetMessagesDelivered();
    incrementMessagesDelivered();
    // A fresh reader (simulating the other process) reads the committed DB value,
    // not an in-process mirror.
    const { getOutboundDb } = require('./db/connection.js');
    const row = getOutboundDb()
      .prepare("SELECT value FROM session_state WHERE key = 'runtime:messages_delivered_turn'")
      .get() as { value: string } | undefined;
    expect(row?.value).toBe('1');
    expect(getMessagesDelivered()).toBe(1);
  });

  test('a turn with no sends reads 0 after reset', () => {
    resetMessagesDelivered();
    expect(getMessagesDelivered()).toBe(0);
  });
});
