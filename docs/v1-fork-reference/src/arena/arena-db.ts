/**
 * Arena SQLite queries — all arena DB operations in one place.
 * Uses the shared better-sqlite3 instance from src/db.ts.
 */

import type {
  ArenaSession,
  ArenaLog,
  ArenaGrade,
  ArenaAggregate,
  RoutingType,
} from './types.js';

// The db instance is imported lazily to avoid circular deps.
// It's set by initArenaDb() called from the orchestrator after initDatabase().
let db: import('better-sqlite3').Database;

export function initArenaDb(database: import('better-sqlite3').Database): void {
  db = database;
}

// --- Sessions ---

export function insertSession(session: {
  sessionId: string;
  userId: number;
  userMessage: string;
  routingType: RoutingType;
  targetedBots: string[] | null;
  botCount: number;
  systemPromptVersion: string;
}): void {
  db.prepare(
    `INSERT INTO arena_sessions (session_id, user_id, user_message, routing_type, targeted_bots, bot_count, system_prompt_version)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    session.sessionId,
    session.userId,
    session.userMessage,
    session.routingType,
    session.targetedBots ? JSON.stringify(session.targetedBots) : null,
    session.botCount,
    session.systemPromptVersion,
  );
}

export function updateSessionStatus(
  sessionId: string,
  status: 'pending' | 'graded' | 'failed',
): void {
  db.prepare(
    `UPDATE arena_sessions SET grading_status = ? WHERE session_id = ?`,
  ).run(status, sessionId);
}

export function getUngradedBroadcastSessionsSince(
  sinceIso: string,
): ArenaSession[] {
  return db
    .prepare(
      `SELECT * FROM arena_sessions
       WHERE grading_status = 'pending'
         AND routing_type = 'broadcast'
         AND timestamp >= ?
       ORDER BY timestamp`,
    )
    .all(sinceIso) as ArenaSession[];
}

// --- Logs ---

export function insertLog(log: {
  sessionId: string;
  botId: string;
  model: string;
  chatId: number;
  userId: number;
  telegramMessageId: number | null;
  parentLogId: number | null;
  promptText: string;
  historyJson: string;
  responseText: string | null;
  toolCallsJson: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  litellmRequestId: string | null;
  latencyMs: number;
  isBroadcast: boolean;
  error: string | null;
}): number {
  const result = db
    .prepare(
      `INSERT INTO arena_logs (
       session_id, bot_id, model, chat_id, user_id, telegram_message_id,
       parent_log_id, prompt_text, history_json, response_text,
       tool_calls_json, tokens_in, tokens_out, litellm_request_id,
       latency_ms, is_broadcast, error
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      log.sessionId,
      log.botId,
      log.model,
      log.chatId,
      log.userId,
      log.telegramMessageId,
      log.parentLogId,
      log.promptText,
      log.historyJson,
      log.responseText,
      log.toolCallsJson,
      log.tokensIn,
      log.tokensOut,
      log.litellmRequestId,
      log.latencyMs,
      log.isBroadcast ? 1 : 0,
      log.error,
    );
  return Number(result.lastInsertRowid);
}

export function updateLogTelegramMessageId(
  logId: number,
  telegramMessageId: number,
): void {
  db.prepare(`UPDATE arena_logs SET telegram_message_id = ? WHERE id = ?`).run(
    telegramMessageId,
    logId,
  );
}

export function updateRating(
  telegramMessageId: number,
  chatId: number,
  rating: number,
): void {
  db.prepare(
    `UPDATE arena_logs SET user_rating = ? WHERE telegram_message_id = ? AND chat_id = ?`,
  ).run(rating, telegramMessageId, chatId);
}

export function markUserReplied(
  telegramMessageId: number,
  chatId: number,
): void {
  db.prepare(
    `UPDATE arena_logs SET user_replied = 1 WHERE telegram_message_id = ? AND chat_id = ?`,
  ).run(telegramMessageId, chatId);
}

export function getLogsBySessionId(sessionId: string): ArenaLog[] {
  return db
    .prepare(`SELECT * FROM arena_logs WHERE session_id = ? ORDER BY bot_id`)
    .all(sessionId) as ArenaLog[];
}

export function getLogByTelegramMessage(
  telegramMessageId: number,
  chatId: number,
): ArenaLog | undefined {
  return db
    .prepare(
      `SELECT * FROM arena_logs WHERE telegram_message_id = ? AND chat_id = ?`,
    )
    .get(telegramMessageId, chatId) as ArenaLog | undefined;
}

/** Walk the parent_log_id chain to reconstruct conversation history for a bot. */
export function getConversationChain(logId: number): ArenaLog[] {
  const chain: ArenaLog[] = [];
  let current = db
    .prepare(`SELECT * FROM arena_logs WHERE id = ?`)
    .get(logId) as ArenaLog | undefined;

  while (current) {
    chain.unshift(current);
    if (!current.parent_log_id) break;
    current = db
      .prepare(`SELECT * FROM arena_logs WHERE id = ?`)
      .get(current.parent_log_id) as ArenaLog | undefined;
  }
  return chain;
}

/** Get recent logs for a specific bot in the arena chat, for building context. */
export function getRecentLogsForBot(
  botId: string,
  chatId: number,
  limit: number = 20,
): ArenaLog[] {
  return db
    .prepare(
      `SELECT * FROM arena_logs
       WHERE bot_id = ? AND chat_id = ?
       ORDER BY timestamp DESC LIMIT ?`,
    )
    .all(botId, chatId, limit) as ArenaLog[];
}

export function updateCost(
  sessionId: string,
  botId: string,
  costUsd: number,
): void {
  db.prepare(
    `UPDATE arena_logs SET cost_usd = ? WHERE session_id = ? AND bot_id = ?`,
  ).run(costUsd, sessionId, botId);
}

// --- Grades ---

export function insertGrades(grades: ArenaGrade[]): void {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO arena_grades (
       arena_log_id, session_id, bot_id, grader_model, grader_version,
       score_total, score_correctness, score_completeness, score_code_quality,
       score_clarity, score_tool_efficiency, grade_rationale
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertMany = db.transaction((items: ArenaGrade[]) => {
    for (const g of items) {
      stmt.run(
        g.arena_log_id,
        g.session_id,
        g.bot_id,
        g.grader_model,
        g.grader_version,
        g.score_total,
        g.score_correctness,
        g.score_completeness,
        g.score_code_quality,
        g.score_clarity,
        g.score_tool_efficiency,
        g.grade_rationale,
      );
    }
  });
  insertMany(grades);
}

// --- Aggregates ---

export function upsertAggregate(agg: ArenaAggregate): void {
  db.prepare(
    `INSERT INTO arena_aggregates (
       model, period_type, period_start, period_end,
       total_sessions, win_rate, avg_overall_score, avg_cost_per_session,
       avg_latency_ms, user_rating_ratio, user_reply_rate,
       tool_call_success_rate, response_count
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(model, period_type, period_start) DO UPDATE SET
       period_end = excluded.period_end,
       total_sessions = excluded.total_sessions,
       win_rate = excluded.win_rate,
       avg_overall_score = excluded.avg_overall_score,
       avg_cost_per_session = excluded.avg_cost_per_session,
       avg_latency_ms = excluded.avg_latency_ms,
       user_rating_ratio = excluded.user_rating_ratio,
       user_reply_rate = excluded.user_reply_rate,
       tool_call_success_rate = excluded.tool_call_success_rate,
       response_count = excluded.response_count`,
  ).run(
    agg.model,
    agg.period_type,
    agg.period_start,
    agg.period_end,
    agg.total_sessions,
    agg.win_rate,
    agg.avg_overall_score,
    agg.avg_cost_per_session,
    agg.avg_latency_ms,
    agg.user_rating_ratio,
    agg.user_reply_rate,
    agg.tool_call_success_rate,
    agg.response_count,
  );
}

export function getAggregatesSince(sinceIso: string): ArenaAggregate[] {
  return db
    .prepare(
      `SELECT * FROM arena_aggregates
       WHERE period_start >= ?
       ORDER BY model, period_start`,
    )
    .all(sinceIso) as ArenaAggregate[];
}

/** Graded log with session id and sub-scores — source of truth for aggregates and quality reports. */
export interface GradedLogRow {
  session_id: string;
  bot_id: string;
  model: string;
  score_total: number;
  score_correctness: number | null;
  score_completeness: number | null;
  score_code_quality: number | null;
  score_clarity: number | null;
  score_tool_efficiency: number | null;
  cost_usd: number | null;
  latency_ms: number;
  user_rating: number;
  user_replied: number;
  tool_calls_json: string | null;
  log_timestamp: string;
}

/**
 * Graded logs in a [start, end) window, keyed by log timestamp.
 * Replaces getGradedDataForPeriod — adds session_id (for win-rate) and sub-scores.
 */
export function getGradedLogsInRange(
  startIso: string,
  endIso: string,
): GradedLogRow[] {
  return db
    .prepare(
      `SELECT l.session_id, l.bot_id, l.model,
              g.score_total, g.score_correctness, g.score_completeness,
              g.score_code_quality, g.score_clarity, g.score_tool_efficiency,
              l.cost_usd, l.latency_ms, l.user_rating, l.user_replied,
              l.tool_calls_json, l.timestamp AS log_timestamp
       FROM arena_grades g
       JOIN arena_logs l ON g.arena_log_id = l.id
       WHERE l.is_broadcast = 1
         AND l.timestamp >= ? AND l.timestamp < ?`,
    )
    .all(startIso, endIso) as GradedLogRow[];
}
