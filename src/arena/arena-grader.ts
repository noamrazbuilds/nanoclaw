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

export async function runDailyGrading(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const sessions = arenaDb.getUngradedBroadcastSessionsSince(cutoff);

  if (sessions.length === 0) {
    logger.info('Arena grading: no ungraded sessions');
    return;
  }

  logger.info({ count: sessions.length }, 'Arena grading: starting');

  for (const session of sessions) {
    const responses = arenaDb.getLogsBySessionId(session.session_id);
    if (responses.length < 2) continue;

    // Skip sessions where all responses are errors
    const validResponses = responses.filter((r) => r.response_text);
    if (validResponses.length === 0) {
      arenaDb.updateSessionStatus(session.session_id, 'failed');
      continue;
    }

    try {
      const grades = await gradeSessionWithRetry(session.session_id, responses);
      arenaDb.insertGrades(grades);
      arenaDb.updateSessionStatus(session.session_id, 'graded');
      logger.info(
        { sessionId: session.session_id, gradesCount: grades.length },
        'Arena grading: session graded',
      );
    } catch (err) {
      logger.error(
        { sessionId: session.session_id, err },
        'Arena grading: failed',
      );
      arenaDb.updateSessionStatus(session.session_id, 'failed');
    }
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
        throw new Error(`Grader LiteLLM ${result.status}`);
      }

      const data = (await result.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty grader response');

      const parsed = JSON.parse(content);
      return mapGraderOutput(sessionId, responses, parsed);
    } catch (err) {
      if (attempt < GRADER_MAX_RETRIES - 1) {
        const delay = Math.pow(2, attempt + 1) * 1000;
        logger.warn({ attempt, delay, err }, 'Arena grader retry');
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
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
