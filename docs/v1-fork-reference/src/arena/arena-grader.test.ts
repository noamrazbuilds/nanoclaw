import { describe, it, expect } from 'vitest';

import {
  GraderHttpError,
  isRetryableGraderError,
  parseGraderJson,
} from './arena-grader.js';

describe('parseGraderJson', () => {
  it('parses raw JSON', () => {
    expect(parseGraderJson('{"grades":[]}')).toEqual({ grades: [] });
  });

  it('strips ```json fenced blocks', () => {
    const content = '```json\n{"grades":[{"bot_id":"a"}]}\n```';
    expect(parseGraderJson(content)).toEqual({
      grades: [{ bot_id: 'a' }],
    });
  });

  it('strips unlabeled ``` fenced blocks', () => {
    const content = '```\n{"grades":[]}\n```';
    expect(parseGraderJson(content)).toEqual({ grades: [] });
  });

  it('ignores leading and trailing whitespace around the fence', () => {
    const content = '\n\n  ```json\n{"ok":true}\n```  \n';
    expect(parseGraderJson(content)).toEqual({ ok: true });
  });

  it('throws SyntaxError on malformed JSON', () => {
    expect(() => parseGraderJson('not json')).toThrow(SyntaxError);
  });
});

describe('GraderHttpError', () => {
  it('includes status and body in message', () => {
    const err = new GraderHttpError(400, '{"error":"model not found"}');
    expect(err.message).toContain('400');
    expect(err.message).toContain('model not found');
  });

  it('truncates oversized bodies', () => {
    const err = new GraderHttpError(500, 'x'.repeat(5000));
    expect(err.message.length).toBeLessThan(1000);
  });
});

describe('isRetryableGraderError', () => {
  it('retries on 5xx', () => {
    expect(isRetryableGraderError(new GraderHttpError(500, ''))).toBe(true);
    expect(isRetryableGraderError(new GraderHttpError(503, ''))).toBe(true);
  });

  it('retries on 408 and 429', () => {
    expect(isRetryableGraderError(new GraderHttpError(408, ''))).toBe(true);
    expect(isRetryableGraderError(new GraderHttpError(429, ''))).toBe(true);
  });

  it('does not retry other 4xx', () => {
    expect(isRetryableGraderError(new GraderHttpError(400, ''))).toBe(false);
    expect(isRetryableGraderError(new GraderHttpError(401, ''))).toBe(false);
    expect(isRetryableGraderError(new GraderHttpError(404, ''))).toBe(false);
  });

  it('retries on non-HTTP errors (network, parse)', () => {
    expect(isRetryableGraderError(new Error('network down'))).toBe(true);
    expect(isRetryableGraderError(new SyntaxError('bad json'))).toBe(true);
  });
});
