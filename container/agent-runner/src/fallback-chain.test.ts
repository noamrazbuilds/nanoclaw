import { describe, test, expect } from 'bun:test';

import { resolveFallbackChain } from './poll-loop.js';

// The credit-error fallback is a CHAIN tried in order (e.g. GPT then Gemini).
// This is the pure parser behind it; the ordering/dedup/back-compat rules are
// what determine which model the agent actually retries on.
describe('resolveFallbackChain', () => {
  test('parses an ordered comma list', () => {
    expect(resolveFallbackChain('gpt-4o,gemini-2.5-pro')).toEqual(['gpt-4o', 'gemini-2.5-pro']);
  });

  test('preserves order (GPT first, then Gemini)', () => {
    expect(resolveFallbackChain('gpt-4o, gemini-2.5-pro')[0]).toBe('gpt-4o');
  });

  test('trims whitespace around entries', () => {
    expect(resolveFallbackChain('  gpt-4o ,  gemini-2.5-pro  ')).toEqual(['gpt-4o', 'gemini-2.5-pro']);
  });

  test('de-duplicates, keeping first occurrence', () => {
    expect(resolveFallbackChain('gpt-4o,gemini-2.5-pro,gpt-4o')).toEqual(['gpt-4o', 'gemini-2.5-pro']);
  });

  test('back-compat: singular is appended after the list', () => {
    expect(resolveFallbackChain('gpt-4o', 'gemini-2.5-pro')).toEqual(['gpt-4o', 'gemini-2.5-pro']);
  });

  test('back-compat: singular-only (no list) still works', () => {
    expect(resolveFallbackChain('', 'gemini-2.5-flash')).toEqual(['gemini-2.5-flash']);
  });

  test('singular already in the list is not duplicated', () => {
    expect(resolveFallbackChain('gpt-4o,gemini-2.5-pro', 'gpt-4o')).toEqual(['gpt-4o', 'gemini-2.5-pro']);
  });

  test('empty / undefined → empty chain (fallback disabled)', () => {
    expect(resolveFallbackChain()).toEqual([]);
    expect(resolveFallbackChain('', '')).toEqual([]);
    expect(resolveFallbackChain(' , , ')).toEqual([]);
  });
});
