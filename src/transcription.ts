import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

import { readEnvFile } from './env.js';

const execFileAsync = promisify(execFile);

const WHISPER_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'whisper_transcribe.py',
);

export const FALLBACK_MESSAGE = '[Voice Message - transcription unavailable]';

async function transcribeWithLocalWhisper(
  buffer: Buffer,
): Promise<string | null> {
  const tmpFile = path.join(os.tmpdir(), `nc-voice-${Date.now()}.ogg`);
  try {
    fs.writeFileSync(tmpFile, buffer);

    const model = process.env.WHISPER_MODEL || 'base';
    const python = process.env.WHISPER_PYTHON || 'python3';

    const { stdout } = await execFileAsync(python, [WHISPER_SCRIPT, tmpFile], {
      timeout: 60_000,
      env: { ...process.env, WHISPER_MODEL: model },
    });

    const transcript = stdout.trim();
    return transcript.length > 0 ? transcript : null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Local whisper transcription failed:', msg);
    return null;
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }
  }
}

async function transcribeWithOpenAI(buffer: Buffer): Promise<string | null> {
  const env = readEnvFile(['OPENAI_API_KEY']);
  const apiKey = env.OPENAI_API_KEY;

  if (!apiKey) {
    console.warn(
      'OPENAI_API_KEY not set — OpenAI transcription fallback unavailable',
    );
    return null;
  }

  try {
    const openaiModule = await import('openai');
    const OpenAI = openaiModule.default;
    const toFile = openaiModule.toFile;

    const openai = new OpenAI({ apiKey });
    const file = await toFile(buffer, 'voice.ogg', { type: 'audio/ogg' });

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      response_format: 'text',
    });

    return ((transcription as unknown as string) || '').trim() || null;
  } catch (err) {
    console.error('OpenAI transcription fallback failed:', err);
    return null;
  }
}

/**
 * Transcribe an audio buffer. Tries local faster-whisper first, falls back
 * to OpenAI API. Channel-agnostic — used by both WhatsApp (Baileys) and
 * Telegram (grammY) adapters in their voice-message inbound handlers.
 *
 * Returns the transcript string, or `FALLBACK_MESSAGE` if both paths fail.
 */
export async function transcribeAudioBuffer(
  buffer: Buffer,
): Promise<string | null> {
  const local = await transcribeWithLocalWhisper(buffer);
  if (local !== null) return local;

  console.log('Local whisper unavailable or failed, trying OpenAI fallback');
  return transcribeWithOpenAI(buffer);
}
