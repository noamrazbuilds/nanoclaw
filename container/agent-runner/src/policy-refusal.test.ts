import { describe, it, expect } from 'bun:test';

import { isPolicyRefusal } from './policy-refusal.js';

describe('isPolicyRefusal', () => {
  it('matches Anthropic Usage-Policy refusal phrasings', () => {
    const hits = [
      'Claude Code is unable to respond to this request, which appears to violate our Usage Policy (https://www.anthropic.com/legal/aup).',
      'Error: Claude Code returned an error result: API Error: Claude Code is unable to respond to this request, which appears to violate our Usage Policy.',
      'The agent refused the request as a Usage Policy violation.',
      'This violates the Usage Policy',
      'flagged per the AUP — appears to violate policy',
    ];
    for (const h of hits) expect(isPolicyRefusal(h)).toBe(true);
  });

  it('does not match unrelated errors or empty input', () => {
    const misses = [
      'rate limit exceeded',
      'credit balance is too low',
      '500 internal server error',
      'our policy is to be helpful', // "policy" without the violation phrasing
      '',
      null,
      undefined,
    ];
    for (const m of misses) expect(isPolicyRefusal(m)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isPolicyRefusal('UNABLE TO RESPOND TO THIS REQUEST')).toBe(true);
    expect(isPolicyRefusal('violates THE usage policy')).toBe(true);
  });
});
