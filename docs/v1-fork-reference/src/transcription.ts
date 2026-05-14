import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { WAMessage, WASocket } from '@whiskeysockets/baileys';

import { readEnvFile } from './env.js';

const execFileAsync = promisify(execFile);

const WHISPER_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'whisper_transcribe.py',
);

const FALLBACK_MESSAGE = '[Voice Message - transcription unavailable]';

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
  } catch (err: any) {
    console.error('Local whisper transcription failed:', err?.message ?? err);
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
 * Transcribe an audio buffer. Tries local faster-whisper first, falls back to OpenAI API.
 * Shared entry point for all channels.
 */
export async function transcribeAudioBuffer(
  buffer: Buffer,
): Promise<string | null> {
  const local = await transcribeWithLocalWhisper(buffer);
  if (local !== null) return local;

  console.log('Local whisper unavailable or failed, trying OpenAI fallback');
  return transcribeWithOpenAI(buffer);
}

/**
 * Download and transcribe a WhatsApp voice message.
 */
export async function transcribeAudioMessage(
  msg: WAMessage,
  sock: WASocket,
): Promise<string | null> {
  try {
    const buffer = (await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger: console as any,
        reuploadRequest: sock.updateMediaMessage,
      },
    )) as Buffer;

    if (!buffer || buffer.length === 0) {
      console.error('Failed to download WhatsApp audio message');
      return FALLBACK_MESSAGE;
    }

    console.log(`Downloaded WhatsApp voice message: ${buffer.length} bytes`);
    return (await transcribeAudioBuffer(buffer)) ?? FALLBACK_MESSAGE;
  } catch (err) {
    console.error('WhatsApp transcription error:', err);
    return FALLBACK_MESSAGE;
  }
}

export function isVoiceMessage(msg: WAMessage): boolean {
  return msg.message?.audioMessage?.ptt === true;
}
