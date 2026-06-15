import { describe, expect, it } from 'vitest';

import { classifyGwsError } from './gws-proxy.js';

// Real outputs captured during the 2026-06-15 "gws_run 43% failed" investigation.
// The whole point of the classifier is that NONE of the agent-fumble cases below
// count as integration failures — only genuine auth/backend/quota errors do.
function r(stdout: string, stderr = '', exitCode = 0) {
  return { stdout, stderr, exitCode, durationMs: 1 };
}

describe('classifyGwsError', () => {
  it('clean success → none', () => {
    expect(classifyGwsError(r('{"files":[{"id":"x"}]}')).errorClass).toBe('none');
  });

  it('CLI unknown-flag (clap) → client', () => {
    const stderr =
      "error: unexpected argument '--fileId' found\n\nUsage: gws files get [OPTIONS]\n\nFor more information, try '--help'.\n";
    const c = classifyGwsError(r('{"error":{"code":400,"reason":"validationError"}}', stderr, 3));
    expect(c.errorClass).toBe('client');
  });

  it('export of a non-native file (403 fileNotExportable) → client', () => {
    const out =
      '{"error":{"code":403,"message":"Export only supports Docs Editors files.","reason":"fileNotExportable"}}';
    expect(classifyGwsError(r(out)).errorClass).toBe('client');
  });

  it('API 400 Invalid Value → client', () => {
    const out = '{"error":{"code":400,"message":"Invalid Value","reason":"invalid"}}';
    expect(classifyGwsError(r(out)).errorClass).toBe('client');
  });

  it('Google backend 500 → integration', () => {
    const out = '{"error":{"code":500,"message":"Internal error encountered.","reason":"backendError"}}';
    const c = classifyGwsError(r(out));
    expect(c.errorClass).toBe('integration');
    expect(c.errorCode).toBe(500);
  });

  it('auth 401 → integration', () => {
    const out = '{"error":{"code":401,"message":"Invalid Credentials","reason":"authError"}}';
    expect(classifyGwsError(r(out)).errorClass).toBe('integration');
  });

  it('insufficient permissions (403 auth) → integration', () => {
    const out = '{"error":{"code":403,"reason":"insufficientPermissions"}}';
    expect(classifyGwsError(r(out)).errorClass).toBe('integration');
  });

  it('rate limit 429 → integration', () => {
    const out = '{"error":{"code":429,"reason":"rateLimitExceeded"}}';
    expect(classifyGwsError(r(out)).errorClass).toBe('integration');
  });

  it('proxy/network failure (nonzero exit, no recognizable error) → integration', () => {
    expect(classifyGwsError(r('', 'gws proxy unreachable: timeout', 1)).errorClass).toBe('integration');
  });
});
