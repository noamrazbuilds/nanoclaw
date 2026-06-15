import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { initTestSessionDb, closeSessionDb } from '../db/connection.js';
import { getUndeliveredMessages } from '../db/messages-out.js';
import type { MessageInRow } from '../db/messages-in.js';
import { applyPreTaskScripts } from './task-script.js';

function taskRow(id: string, script: string | null, prompt = 'fallback prompt'): MessageInRow {
  return {
    id,
    seq: null,
    kind: 'task',
    timestamp: '2026-06-15T00:00:00.000Z',
    status: 'pending',
    process_after: null,
    recurrence: '0 5 * * *',
    tries: 0,
    trigger: 1,
    platform_id: 'telegram:145958767',
    channel_type: 'telegram',
    thread_id: null,
    content: JSON.stringify({ prompt, script }),
  };
}

beforeEach(() => initTestSessionDb());
afterEach(() => closeSessionDb());

describe('applyPreTaskScripts — script outbox', () => {
  it('enqueues script-emitted messages to the task destination without waking the agent', async () => {
    const script = `echo '{"wakeAgent": false, "send": [{"text": "💱 USD/ILS: 3.6712"}]}'`;
    const out = await applyPreTaskScripts([taskRow('t1', script)]);

    // Agent NOT woken (task gated out of the prompt).
    expect(out.keep).toHaveLength(0);
    expect(out.skipped).toEqual(['t1']);

    // ...but the message was delivered through the normal outbound path.
    const delivered = getUndeliveredMessages();
    expect(delivered).toHaveLength(1);
    expect(delivered[0].channel_type).toBe('telegram');
    expect(delivered[0].platform_id).toBe('telegram:145958767');
    expect(JSON.parse(delivered[0].content).text).toBe('💱 USD/ILS: 3.6712');
  });

  it('can both send a message AND wake the agent (e.g. data + fallback)', async () => {
    const script = `echo '{"wakeAgent": true, "send": [{"text": "heads up"}], "data": {"n": 1}}'`;
    const out = await applyPreTaskScripts([taskRow('t2', script)]);

    expect(out.keep).toHaveLength(1);
    expect(JSON.parse(out.keep[0].content).scriptOutput).toEqual({ n: 1 });
    expect(getUndeliveredMessages()).toHaveLength(1);
  });

  it('ignores blank/missing send texts', async () => {
    const script = `echo '{"wakeAgent": false, "send": [{"text": "   "}, {"text": ""}]}'`;
    const out = await applyPreTaskScripts([taskRow('t3', script)]);
    expect(out.skipped).toEqual(['t3']);
    expect(getUndeliveredMessages()).toHaveLength(0);
  });

  it('a failing script sends nothing and is skipped', async () => {
    const out = await applyPreTaskScripts([taskRow('t4', 'exit 1')]);
    expect(out.skipped).toEqual(['t4']);
    expect(getUndeliveredMessages()).toHaveLength(0);
  });
});
