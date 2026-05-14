/**
 * Arena configuration — bot definitions, model mapping, prompts.
 * Bot tokens are read from .env (ARENA_BOT_TOKEN_*).
 */

import { readEnvFile } from '../env.js';
import { LITELLM_API_KEY, LITELLM_PROXY_URL } from '../config.js';
import type { ArenaBotConfig } from './types.js';

const envConfig = readEnvFile([
  'ARENA_ENABLED',
  'ARENA_BOT_TOKEN_DEEPSEEK',
  'ARENA_BOT_TOKEN_KIMI',
  'ARENA_BOT_TOKEN_MINIMAX',
  'ARENA_BOT_TOKEN_QWEN',
  'ARENA_BOT_TOKEN_GEMMA',
  'ARENA_BOT_TOKEN_SONNET',
]);

export const ARENA_ENABLED =
  (process.env.ARENA_ENABLED || envConfig.ARENA_ENABLED) === 'true';

export const ARENA_CHAT_ID = -1003935516896;
export const ARENA_USER_ID = 145958767;

// Arena runs on the host directly (not in containers), so always use localhost.
// LITELLM_PROXY_URL may point to host.docker.internal for container use.
export const ARENA_LITELLM_URL = 'http://localhost:4000';
export const ARENA_LITELLM_KEY = LITELLM_API_KEY;

/** Delay between bot responses to avoid Telegram rate limits. */
export const SEND_STAGGER_MS = 200;

/** Timeout for local model inference (ms). Locals are serialized on 1vCPU, so a long timeout is fine — only one runs at a time. */
export const LOCAL_MODEL_TIMEOUT_MS = 600_000;

/** Timeout for local model tool calls (ms). */
export const LOCAL_TOOL_TIMEOUT_MS = 10_000;

/** Grading config */
export const GRADER_MODEL = 'claude-sonnet-4-6';
export const GRADER_VERSION = '1.0.0';
export const GRADER_MAX_RETRIES = 3;

/** Cron expressions (minute hour dayOfMonth month dayOfWeek) */
export const GRADING_CRON = '0 2 * * *'; // 2 AM daily
export const REPORT_CRON = '0 8 * * 5'; // 8 AM Friday

/** System prompt version — logged with each session for attribution. */
export const SYSTEM_PROMPT_VERSION = '1.0.0';

/** Identical system prompt given to all arena bots. */
export const ARENA_SYSTEM_PROMPT = `You are a helpful AI assistant participating in a model comparison arena. Answer the user's questions accurately, concisely, and helpfully. If you're unsure about something, say so rather than guessing. Do not attempt to use tools or generate tool call syntax — respond with text only.`;

/** Build bot configs from env tokens. Missing tokens are skipped at startup. */
export function buildBotConfigs(): ArenaBotConfig[] {
  const defs: Array<
    Omit<ArenaBotConfig, 'token' | 'telegramUserId'> & { envKey: string }
  > = [
    {
      id: 'deepseek-v3',
      model: 'deepseek-v3.2',
      username: 'nanoclaw_deepseek_bot',
      displayName: 'DeepSeek V3.2',
      local: false,
      envKey: 'ARENA_BOT_TOKEN_DEEPSEEK',
    },
    {
      id: 'kimi-k2',
      model: 'kimi-k2.5',
      username: 'nanoclaw_kimi_bot',
      displayName: 'Kimi K2.5',
      local: false,
      envKey: 'ARENA_BOT_TOKEN_KIMI',
    },
    {
      id: 'minimax-m2',
      model: 'minimax-m2.5',
      username: 'nanoclaw_minimax_bot',
      displayName: 'MiniMax M2.5',
      local: false,
      envKey: 'ARENA_BOT_TOKEN_MINIMAX',
    },
    {
      id: 'qwen-3b',
      model: 'local-coder',
      username: 'nanoclaw_qwen_bot',
      displayName: 'Qwen Coder 3B',
      local: true,
      envKey: 'ARENA_BOT_TOKEN_QWEN',
    },
    {
      id: 'gemma-4b',
      model: 'local-general',
      username: 'nanoclaw_gemma_bot',
      displayName: 'Gemma 4B',
      local: true,
      envKey: 'ARENA_BOT_TOKEN_GEMMA',
    },
    {
      id: 'claude-sonnet',
      model: 'claude-sonnet-4-6',
      username: 'nanoclaw_sonnet_bot',
      displayName: 'Claude Sonnet 4.6',
      local: false,
      envKey: 'ARENA_BOT_TOKEN_SONNET',
    },
  ];

  const configs: ArenaBotConfig[] = [];
  for (const def of defs) {
    const token = process.env[def.envKey] || envConfig[def.envKey] || '';
    if (!token) continue;
    const { envKey: _, ...rest } = def;
    configs.push({ ...rest, token });
  }
  return configs;
}
