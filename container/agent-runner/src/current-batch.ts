/**
 * Per-batch context the poll loop publishes for downstream consumers
 * (MCP tools, etc.) that don't sit on the poll-loop's call stack.
 *
 * Today the only field is `inReplyTo` — the id of the first inbound
 * message in the batch the agent is currently processing. MCP tools like
 * `send_message` and `send_file` read this and stamp it onto the outbound
 * row so the host's a2a return-path routing can correlate replies back to
 * the originating session.
 *
 * This is module-level state on purpose: the agent-runner is single-process
 * and processes one batch at a time. Poll-loop calls `setCurrentInReplyTo`
 * before invoking the provider and `clearCurrentInReplyTo` after the batch
 * completes (or errors out).
 */
let currentInReplyTo: string | null = null;

export function setCurrentInReplyTo(id: string | null): void {
  currentInReplyTo = id;
}

export function clearCurrentInReplyTo(): void {
  currentInReplyTo = null;
}

export function getCurrentInReplyTo(): string | null {
  return currentInReplyTo;
}

/**
 * C4 part 3: transitive output suppression. Set true while the runner is
 * processing a scheduled task whose content declares `suppress_chat_output`.
 * The `send_message` MCP tool consults this and drops intermediate chat sends —
 * the progress / multi-subagent-orchestration messages that leaked to chat in
 * the 2026-05-15 incident. The agent's FINAL result (dispatchResultText) is NOT
 * gated by this flag, so the task's digest still goes out: "release only the
 * final result." Cleared after the batch completes or errors.
 */
let suppressChatOutput = false;

export function setSuppressChatOutput(value: boolean): void {
  suppressChatOutput = value;
}

export function getSuppressChatOutput(): boolean {
  return suppressChatOutput;
}

