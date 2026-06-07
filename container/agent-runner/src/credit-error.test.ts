import { describe, it, expect } from 'bun:test';

import { isCreditError } from './credit-error.js';

describe('isCreditError', () => {
  it('matches Anthropic credit-exhaustion phrasings', () => {
    const hits = [
      'Your credit balance is too low to access the Anthropic API',
      '{"type":"error","error":{"type":"credit_balance_too_low"}}',
      'insufficient credits',
      'You are out of credits',
      'billing hard limit reached',
      'HTTP 402 Payment Required',
      'payment required',
    ];
    for (const h of hits) expect(isCreditError(h)).toBe(true);
  });

  it('does not match unrelated errors or empty input', () => {
    const misses = [
      'rate limit exceeded',
      '500 internal server error',
      'tool execution failed',
      'the balance sheet is ready', // "balance" without the credit phrasing
      '',
      null,
      undefined,
    ];
    for (const m of misses) expect(isCreditError(m)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isCreditError('CREDIT BALANCE TOO LOW')).toBe(true);
    expect(isCreditError('Insufficient Credits')).toBe(true);
  });
});
