/**
 * C1: detect Anthropic credit-balance exhaustion in an SDK result/error string.
 *
 * Anthropic signals a dry credit balance either as a thrown error, as an
 * in-stream 'error' event, or — an SDK quirk — as a "successful" result whose
 * text IS the API error. When any of these match, the agent-runner swallows the
 * raw error and re-runs the request once on the configured fallback model
 * (reached via ANTHROPIC_BASE_URL → the user's LiteLLM proxy; see poll-loop).
 *
 * Patterns ported from the v1 fork (oauth-refresh.ts isCreditError). Matching is
 * case-insensitive and substring-based — the message wording varies across the
 * API, the SDK wrapper, and proxy layers.
 */
const CREDIT_ERROR_PATTERNS: RegExp[] = [
  /credit\s*balance\s*(is\s*)?too\s*low/i,
  /credit_balance_too_low/i,
  /insufficient\s*credits?/i,
  /out\s*of\s*credits?/i,
  /billing\s*(hard\s*)?limit/i,
  /payment\s*required/i,
  /\b402\b/,
];

export function isCreditError(text: string | null | undefined): boolean {
  if (!text) return false;
  return CREDIT_ERROR_PATTERNS.some((re) => re.test(text));
}
