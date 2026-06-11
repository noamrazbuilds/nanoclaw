/**
 * Tests for the core MCP tools' interaction with the per-batch routing
 * context. The agent-runner sets a current `inReplyTo` at the top of each
 * batch in poll-loop, and outbound writes from MCP tools (send_message,
 * send_file) must pick it up so a2a return-path routing on the host can
 * correlate replies back to the originating session.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { initTestSessionDb, closeSessionDb, getInboundDb, getOutboundDb } from '../db/connection.js';
import { getUndeliveredMessages } from '../db/messages-out.js';
import { setCurrentInReplyTo, clearCurrentInReplyTo, setSuppressChatOutput } from '../current-batch.js';
import { sendMessage } from './core.js';

beforeEach(() => {
  initTestSessionDb();
  // Seed a peer agent destination
  getInboundDb()
    .prepare(
      `INSERT INTO destinations (name, display_name, type, channel_type, platform_id, agent_group_id)
       VALUES ('peer', 'Peer', 'agent', NULL, NULL, 'ag-peer')`,
    )
    .run();
});

afterEach(() => {
  clearCurrentInReplyTo();
  setSuppressChatOutput(false);
  closeSessionDb();
});

describe('send_message MCP tool — in_reply_to plumbing', () => {
  it('stamps current batch in_reply_to on outbound rows', async () => {
    setCurrentInReplyTo('inbound-msg-1');

    await sendMessage.handler({ to: 'peer', text: 'hello' });

    const out = getUndeliveredMessages();
    expect(out).toHaveLength(1);
    expect(out[0].in_reply_to).toBe('inbound-msg-1');
  });

  it('writes null when no batch is active', async () => {
    // No setCurrentInReplyTo before this call — simulates ad-hoc / out-of-batch invocation.
    await sendMessage.handler({ to: 'peer', text: 'hello' });

    const out = getUndeliveredMessages();
    expect(out).toHaveLength(1);
    expect(out[0].in_reply_to).toBeNull();
  });
});

describe('send_message MCP tool — suppress_chat_output (cross-process bridge)', () => {
  it('drops the outbound row when suppression is active', async () => {
    setSuppressChatOutput(true);

    const res = await sendMessage.handler({ to: 'peer', text: 'progress update' });

    // No row written, but the agent is told success so it doesn't retry/derail.
    expect(getUndeliveredMessages()).toHaveLength(0);
    expect(res.content?.[0]?.text ?? '').toContain('suppressed');
  });

  it('sends normally once suppression is cleared', async () => {
    setSuppressChatOutput(true);
    await sendMessage.handler({ to: 'peer', text: 'suppressed' });
    setSuppressChatOutput(false);
    await sendMessage.handler({ to: 'peer', text: 'now visible' });

    const out = getUndeliveredMessages();
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0].content).text).toBe('now visible');
  });

  it('the suppress flag is persisted to session_state (visible to the MCP subprocess)', () => {
    // The whole point of the fix: the value lives in outbound.db, not just
    // process memory, so the separately-spawned MCP server reads the real value.
    setSuppressChatOutput(true);
    const row = getOutboundDb()
      .prepare("SELECT value FROM session_state WHERE key = 'runtime:suppress_chat_output'")
      .get() as { value: string } | undefined;
    expect(row?.value).toBe('1');
  });
});
