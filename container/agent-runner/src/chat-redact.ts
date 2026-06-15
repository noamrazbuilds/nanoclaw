/**
 * Redact gws write-confirmation nonces from chat-bound text.
 *
 * A gws write op (email send, sheet append, …) returns a 32-hex-char nonce that
 * the agent must pass back via `confirmed_nonce` to execute. The nonce is an
 * internal protocol token — the user never needs to see it. The agent is
 * instructed (gws-mcp-stdio.ts) to describe the action in plain language and
 * never paste the nonce, but instructions are soft. This is the hard guard at
 * the chat boundary: any 32-hex token adjacent to the word "nonce" (the gws
 * confirmation shape) is replaced before the message reaches a human.
 *
 * Scoped to the "nonce" context on purpose — a bare 32-hex string elsewhere
 * (a git sha, an id) is left alone to avoid mangling legitimate content.
 */
const NONCE_PHRASE_RE = /(\bnonce\b[`'":=\s]*)([a-f0-9]{32})\b/gi;

export function redactNonce(text: string): string {
  if (!text) return text;
  return text.replace(NONCE_PHRASE_RE, (_m, prefix: string) => `${prefix}[redacted]`);
}
