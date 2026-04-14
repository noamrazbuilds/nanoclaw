/**
 * LiteLLM call wrapper for arena bots.
 * Sends chat completions with fallbacks disabled and arena metadata.
 */

import {
  ARENA_LITELLM_URL,
  ARENA_LITELLM_KEY,
  LOCAL_MODEL_TIMEOUT_MS,
  ARENA_SYSTEM_PROMPT,
} from './arena-config.js';
import type { ArenaBotConfig, ChatMessage, LLMResponse } from './types.js';
import { logger } from '../logger.js';

export async function callModel(
  botConfig: ArenaBotConfig,
  history: ChatMessage[],
  userMessage: string,
  sessionId: string,
): Promise<LLMResponse> {
  const messages: ChatMessage[] = [
    { role: 'system', content: ARENA_SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const payload: Record<string, unknown> = {
    model: botConfig.model,
    messages,
    fallbacks: [], // Explicitly disabled — no silent model substitution
    metadata: {
      arena_session: true,
      bot_id: botConfig.id,
      session_id: sessionId,
    },
  };

  if (botConfig.local) {
    payload.timeout = LOCAL_MODEL_TIMEOUT_MS / 1000;
  }

  const url = `${ARENA_LITELLM_URL}/chat/completions`;
  const startTime = Date.now();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ARENA_LITELLM_KEY
        ? { Authorization: `Bearer ${ARENA_LITELLM_KEY}` }
        : {}),
    },
    body: JSON.stringify(payload),
    signal: botConfig.local
      ? AbortSignal.timeout(LOCAL_MODEL_TIMEOUT_MS)
      : AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `LiteLLM ${response.status} for ${botConfig.model}: ${body.slice(0, 500)}`,
    );
  }

  const data = (await response.json()) as {
    id?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  const latency = Date.now() - startTime;

  const choice = data.choices?.[0];
  // Some models (e.g. Kimi K2.5) return reasoning_content instead of content
  const content =
    choice?.message?.content ||
    (choice?.message as Record<string, unknown>)?.reasoning_content;
  if (!content || typeof content !== 'string') {
    throw new Error(`Empty response from ${botConfig.model}`);
  }

  logger.debug(
    {
      bot: botConfig.id,
      model: botConfig.model,
      latencyMs: latency,
      tokensIn: data.usage?.prompt_tokens,
      tokensOut: data.usage?.completion_tokens,
    },
    'Arena model call complete',
  );

  return {
    text: content,
    usage: data.usage
      ? {
          prompt_tokens: data.usage.prompt_tokens,
          completion_tokens: data.usage.completion_tokens,
        }
      : undefined,
    requestId:
      data.id || response.headers.get('x-litellm-call-id') || undefined,
  };
}
