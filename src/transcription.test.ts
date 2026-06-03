import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock readEnvFile to control the OPENAI_API_KEY surface deterministically.
const mockReadEnvFile = vi.fn<(keys: string[]) => Record<string, string>>();
vi.mock('./env.js', () => ({
  readEnvFile: (keys: string[]) => mockReadEnvFile(keys),
}));

// Mock child_process so the whisper subprocess never actually runs.
// transcribeWithLocalWhisper uses execFile via promisify; making execFile's
// callback synchronously invoke the error path is enough for the helper to
// observe a failure and return null.
vi.mock('child_process', () => ({
  execFile: (
    _file: string,
    _args: string[],
    _opts: unknown,
    cb: (err: Error | null, stdout?: string, stderr?: string) => void,
  ) => {
    cb(new Error('mocked: whisper subprocess unavailable in unit test'));
  },
}));

describe('transcribeAudioBuffer', () => {
  beforeEach(() => {
    mockReadEnvFile.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports FALLBACK_MESSAGE with the exact v1 string', async () => {
    const { FALLBACK_MESSAGE } = await import('./transcription.js');
    // User-visible text; preserved verbatim across the v1→v2 migration.
    expect(FALLBACK_MESSAGE).toBe('[Voice Message - transcription unavailable]');
  });

  it('returns null when local whisper fails and no OPENAI_API_KEY is set', async () => {
    // Simulate: no OpenAI key, so the fallback path also bails out.
    mockReadEnvFile.mockReturnValue({});

    // Spy on console to keep the test output clean — the helper logs on
    // both failure paths.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { transcribeAudioBuffer } = await import('./transcription.js');

    // Passing an empty buffer makes the whisper script reject (empty .ogg).
    // execFile invocation will fail; helper returns null. With no API key,
    // the OpenAI fallback short-circuits to null as well.
    const result = await transcribeAudioBuffer(Buffer.alloc(0));

    expect(result).toBeNull();
    expect(mockReadEnvFile).toHaveBeenCalledWith(['OPENAI_API_KEY']);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('OPENAI_API_KEY not set'));

    warnSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });
});
