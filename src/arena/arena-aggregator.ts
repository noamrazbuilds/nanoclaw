/**
 * Arena aggregate computation — rolls raw graded logs into per-model, per-day
 * rows in arena_aggregates for fast report queries. Runs after daily grading.
 */

import * as arenaDb from './arena-db.js';
import type { GradedLogRow } from './arena-db.js';
import type { ArenaAggregate } from './types.js';
import { logger } from '../logger.js';

/** Inclusive start / exclusive end of a UTC day, as ISO strings. */
function dayBounds(dayIso: string): { start: string; end: string } {
  const start = new Date(`${dayIso}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function toolCallSuccessRate(rows: GradedLogRow[]): number | null {
  let total = 0;
  let successes = 0;
  for (const r of rows) {
    if (!r.tool_calls_json) continue;
    try {
      const calls = JSON.parse(r.tool_calls_json) as Array<{ success?: boolean }>;
      for (const c of calls) {
        total++;
        if (c.success) successes++;
      }
    } catch {
      // Malformed JSON — skip.
    }
  }
  return total === 0 ? null : successes / total;
}

/**
 * Compute per-model aggregates for the logs in [start, end). Win-rate only
 * counts sessions where ≥2 models were graded, since a solo session always
 * trivially "wins".
 */
export function buildDailyAggregates(
  rows: GradedLogRow[],
  periodStart: string,
  periodEnd: string,
): ArenaAggregate[] {
  if (rows.length === 0) return [];

  const sessionsByModel = new Map<string, Set<string>>();
  const rowsByModel = new Map<string, GradedLogRow[]>();
  const scoresBySession = new Map<string, GradedLogRow[]>();

  for (const r of rows) {
    if (!sessionsByModel.has(r.model)) sessionsByModel.set(r.model, new Set());
    sessionsByModel.get(r.model)!.add(r.session_id);
    if (!rowsByModel.has(r.model)) rowsByModel.set(r.model, []);
    rowsByModel.get(r.model)!.push(r);
    if (!scoresBySession.has(r.session_id))
      scoresBySession.set(r.session_id, []);
    scoresBySession.get(r.session_id)!.push(r);
  }

  // Winners per session (ties split).
  const winShareByModel = new Map<string, number>();
  const competitiveSessionsByModel = new Map<string, number>();
  for (const [, sessionRows] of scoresBySession) {
    if (sessionRows.length < 2) continue;
    const top = Math.max(...sessionRows.map((s) => s.score_total));
    const winners = sessionRows.filter((s) => s.score_total === top);
    const share = 1 / winners.length;
    for (const r of sessionRows) {
      competitiveSessionsByModel.set(
        r.model,
        (competitiveSessionsByModel.get(r.model) ?? 0) + 1,
      );
    }
    for (const w of winners) {
      winShareByModel.set(
        w.model,
        (winShareByModel.get(w.model) ?? 0) + share,
      );
    }
  }

  const out: ArenaAggregate[] = [];
  for (const [model, modelRows] of rowsByModel) {
    const sessionCount = sessionsByModel.get(model)!.size;
    const totalScore = modelRows.reduce((s, r) => s + r.score_total, 0);
    const totalLatency = modelRows.reduce((s, r) => s + r.latency_ms, 0);
    const totalCost = modelRows.reduce((s, r) => s + (r.cost_usd ?? 0), 0);
    const costedRows = modelRows.filter((r) => r.cost_usd != null).length;

    const ratings = modelRows.filter((r) => r.user_rating !== 0);
    const ratingSum = ratings.reduce((s, r) => s + r.user_rating, 0);
    const replied = modelRows.filter((r) => r.user_replied === 1).length;

    const competitive = competitiveSessionsByModel.get(model) ?? 0;
    const winShare = winShareByModel.get(model) ?? 0;

    out.push({
      model,
      period_type: 'daily',
      period_start: periodStart,
      period_end: periodEnd,
      total_sessions: sessionCount,
      win_rate: competitive > 0 ? winShare / competitive : null,
      avg_overall_score: totalScore / modelRows.length,
      avg_cost_per_session: costedRows > 0 ? totalCost / costedRows : null,
      avg_latency_ms: totalLatency / modelRows.length,
      user_rating_ratio: ratings.length > 0 ? ratingSum / ratings.length : null,
      user_reply_rate: replied / modelRows.length,
      tool_call_success_rate: toolCallSuccessRate(modelRows),
      response_count: modelRows.length,
    });
  }

  return out;
}

/**
 * Recompute and upsert aggregates for each of the last `days` UTC days.
 * Idempotent: re-running produces the same rows. Safe to call after every
 * grading run to pick up newly-graded-but-old sessions.
 */
export function runDailyAggregation({
  days = 14,
}: { days?: number } = {}): void {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  let written = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const dayIso = d.toISOString().slice(0, 10);
    const { start, end } = dayBounds(dayIso);
    const rows = arenaDb.getGradedLogsInRange(start, end);
    const aggregates = buildDailyAggregates(rows, start, end);
    for (const agg of aggregates) {
      arenaDb.upsertAggregate(agg);
      written++;
    }
  }
  logger.info({ days, written }, 'Arena aggregates recomputed');
}
