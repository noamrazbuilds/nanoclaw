/**
 * Arena daily grading job.
 * Grades ungraded broadcast sessions using Claude Sonnet via LiteLLM.
 */

import {
  ARENA_LITELLM_URL,
  ARENA_LITELLM_KEY,
  GRADER_MODEL,
  GRADER_VERSION,
  GRADER_MAX_RETRIES,
} from './arena-config.js';
import * as arenaDb from './arena-db.js';
import { runDailyAggregation } from './arena-aggregator.js';
import type { ArenaGrade, ArenaLog } from './types.js';
import { logger } from '../logger.js';

const GRADER_SYSTEM_PROMPT = `You are an expert AI evaluator. You will receive a user prompt and responses from multiple AI models.
Score each response on the following rubric (return valid JSON):

- correctness (0-25): Is the response factually accurate and logically sound?
- completeness (0-20): Does it fully address all parts of the question?
- code_quality (0-20): If code is present: correctness, style, efficiency. If no code: null.
- clarity (0-20): Is the response clear, well-structured, appropriately concise?
- tool_efficiency (0-15): If tools were used: were the right tools chosen, used correctly? If no tools: null.

Return format:
{
  "grades": [
    {
      "bot_id": "...",
      "scores": { "correctness": N, "completeness": N, "code_quality": N, "clarity": N, "tool_efficiency": N },
      "total": 0-100,
      "rationale": "Brief explanation"
    }
  ]
}

Be objective. Grade the response quality, not the model brand.
If a response is an error or empty, score it 0 across all dimensions.
For dimensions marked null (no code / no tools), redistribute the weight proportionally across active dimensions.`;

function buildGraderPrompt(responses: ArenaLog[]): string {
  const prompt = responses[0].prompt_text;
  const responsesText = responses
    .map(
      (r) =>
        `=== ${r.bot_id} ===\n${r.response_text ?? '[ERROR: No response]'}\n` +
        (r.tool_calls_json ? `[Tools used: ${r.tool_calls_json}]\n` : ''),
    )
    .join('\n');
  return `User Prompt:\n${prompt}\n\nModel Responses:\n${responsesText}`;
}

/**
 * Parse grader JSON output. `response_format: json_object` usually returns
 * raw JSON, but some models still wrap it in ```json … ``` fences, which
 * blows up JSON.parse. Strip the fence before parsing.
 */
export function parseGraderJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

/**
 * 4xx client errors (except 408/429) are permanent — the request shape,
 * model name, auth, or budget is wrong, and retrying won't help. Only
 * retry on network errors, 5xx, 408 Request Timeout, and 429 Too Many Requests.
 */
export function isRetryableGraderError(err: unknown): boolean {
  if (!(err instanceof GraderHttpError)) return true;
  if (err.status >= 500) return true;
  if (err.status === 408 || err.status === 429) return true;
  return false;
}

export class GraderHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Grader LiteLLM ${status}: ${body.slice(0, 500)}`);
    this.name = 'GraderHttpError';
  }
}

export async function runDailyGrading(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const sessions = arenaDb.getUngradedBroadcastSessionsSince(cutoff);

  if (sessions.length === 0) {
    logger.info('Arena grading: no ungraded sessions');
    return;
  }

  logger.info({ count: sessions.length }, 'Arena grading: starting');

  for (const session of sessions) {
    await gradeOneSession(session.session_id);
  }

  runDailyAggregation();
}

/**
 * Grade a single session by id. Updates status to 'graded' on success
 * or 'failed' on permanent error. Safe to call on any session regardless
 * of age — used by both the daily cron and one-shot requeue scripts.
 */
export async function gradeOneSession(sessionId: string): Promise<'graded' | 'failed'> {
  const responses = arenaDb.getLogsBySessionId(sessionId);
  const validResponses = responses.filter((r) => r.response_text);

  if (validResponses.length === 0) {
    arenaDb.updateSessionStatus(sessionId, 'failed');
    return 'failed';
  }

  try {
    const grades = await gradeSessionWithRetry(sessionId, validResponses);
    arenaDb.insertGrades(grades);
    arenaDb.updateSessionStatus(sessionId, 'graded');
    logger.info(
      { sessionId, gradesCount: grades.length },
      'Arena grading: session graded',
    );
    return 'graded';
  } catch (err) {
    logger.error({ sessionId, err }, 'Arena grading: failed');
    arenaDb.updateSessionStatus(sessionId, 'failed');
    return 'failed';
  }
}

async function gradeSessionWithRetry(
  sessionId: string,
  responses: ArenaLog[],
): Promise<ArenaGrade[]> {
  for (let attempt = 0; attempt < GRADER_MAX_RETRIES; attempt++) {
    try {
      const prompt = buildGraderPrompt(responses);
      const result = await fetch(`${ARENA_LITELLM_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(ARENA_LITELLM_KEY
            ? { Authorization: `Bearer ${ARENA_LITELLM_KEY}` }
            : {}),
        },
        body: JSON.stringify({
          model: GRADER_MODEL,
          messages: [
            { role: 'system', content: GRADER_SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
          metadata: { arena_grader: true, session_id: sessionId },
        }),
      });

      if (!result.ok) {
        const body = await result.text().catch(() => '');
        throw new GraderHttpError(result.status, body);
      }

      const data = (await result.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty grader response');

      const parsed = parseGraderJson(content) as Parameters<
        typeof mapGraderOutput
      >[2];
      return mapGraderOutput(sessionId, responses, parsed);
    } catch (err) {
      const isLastAttempt = attempt >= GRADER_MAX_RETRIES - 1;
      if (isLastAttempt || !isRetryableGraderError(err)) {
        throw err;
      }
      const delay = Math.pow(2, attempt + 1) * 1000;
      logger.warn({ attempt, delay, err }, 'Arena grader retry');
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('Unreachable');
}

function mapGraderOutput(
  sessionId: string,
  responses: ArenaLog[],
  parsed: {
    grades: Array<{
      bot_id: string;
      scores: Record<string, number | null>;
      total: number;
      rationale: string;
    }>;
  },
): ArenaGrade[] {
  const grades: ArenaGrade[] = [];

  for (const grade of parsed.grades) {
    const log = responses.find((r) => r.bot_id === grade.bot_id);
    if (!log) continue;

    grades.push({
      arena_log_id: log.id,
      session_id: sessionId,
      bot_id: grade.bot_id,
      grader_model: GRADER_MODEL,
      grader_version: GRADER_VERSION,
      score_total: grade.total,
      score_correctness: grade.scores.correctness ?? null,
      score_completeness: grade.scores.completeness ?? null,
      score_code_quality: grade.scores.code_quality ?? null,
      score_clarity: grade.scores.clarity ?? null,
      score_tool_efficiency: grade.scores.tool_efficiency ?? null,
      grade_rationale: grade.rationale ?? null,
    });
  }

  return grades;
}
