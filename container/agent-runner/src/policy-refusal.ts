/**
 * Detect an Anthropic Usage-Policy refusal in an SDK result/error string.
 *
 * The Agent SDK surfaces a content-policy refusal three ways, mirroring the
 * credit-error quirk (see credit-error.ts): as a thrown error, as an in-stream
 * 'error' event, or as a "successful" result whose text IS the refusal. The
 * canonical wording is:
 *
 *   "Claude Code is unable to respond to this request, which appears to
 *    violate our Usage Policy (https://www.anthropic.com/legal/aup)."
 *
 * When matched, the agent-runner swallows the raw, alarming API string and (for
 * interactive turns) replaces it with a brief, non-alarming note. This keeps a
 * narrow per-request safety classifier hit — e.g. one news-search subagent
 * researching antisemitic incidents — from surfacing as a scary "API Error"
 * that reads like an account-level block. Suppressed (silent) tasks dispatch
 * nothing, same as the credit path.
 *
 * Matching is case-insensitive and substring-based; wording varies across the
 * API, the SDK wrapper, and the Task-subagent error envelope.
 */
const POLICY_REFUSAL_PATTERNS: RegExp[] = [
  /unable to respond to this request/i,
  /violate[sd]?\s+(our|the)\s+usage policy/i,
  /usage policy violation/i,
  /\baup\b.*violat/i,
];

export function isPolicyRefusal(text: string | null | undefined): boolean {
  if (!text) return false;
  return POLICY_REFUSAL_PATTERNS.some((re) => re.test(text));
}

/**
 * The user-facing replacement for a raw refusal string on an interactive turn.
 * Deliberately calm and accurate: it was an automated wording check on this
 * request, not a block on the user or the subject matter.
 */
export const POLICY_REFUSAL_NOTICE =
  '⚠️ Part of this request was declined by an automated content-safety check on the wording, ' +
  'so that piece was skipped. This is not a block on you or the topic — rephrasing usually clears it. ' +
  'Anything else in the request that completed is unaffected.';
