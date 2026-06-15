import { describe, it, expect } from 'bun:test';

import { redactNonce } from './chat-redact.js';

const NONCE = 'fab0c073fb4d4b26f1e877e1408fdba6'; // 32 hex chars

describe('redactNonce', () => {
  it('redacts a gws confirmation nonce in various phrasings', () => {
    expect(redactNonce(`The email send requires gws_run confirmation with nonce \`${NONCE}\``)).not.toContain(NONCE);
    expect(redactNonce(`nonce: ${NONCE}`)).toBe('nonce: [redacted]');
    expect(redactNonce(`nonce=${NONCE}`)).toBe('nonce=[redacted]');
    expect(redactNonce(`Nonce "${NONCE}"`)).not.toContain(NONCE);
  });

  it('leaves a 32-hex token alone when not near the word "nonce"', () => {
    const sha = 'a'.repeat(32);
    expect(redactNonce(`commit ${sha} landed`)).toContain(sha);
  });

  it('is a no-op on text without a nonce', () => {
    expect(redactNonce('Ready to email the daily update to noam@raz.net — ok?')).toBe(
      'Ready to email the daily update to noam@raz.net — ok?',
    );
    expect(redactNonce('')).toBe('');
  });
});
