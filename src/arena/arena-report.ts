/**
 * Arena report generation — weekly + on-demand.
 * Groups per-day aggregates into one row per model over the report window, and
 * pulls raw graded logs for the same window to show sub-score quality breakdowns.
 */

import * as arenaDb from './arena-db.js';
import type { GradedLogRow } from './arena-db.js';
import { logger } from '../logger.js';

interface ModelRollup {
  model: string;
  sessions: number;
  responses: number;
  weightedScoreSum: number; // sum(avg_overall_score * response_count)
  weightedLatencySum: number;
  weightedCostSum: number;
  weightedCostResponses: number; // responses that had a cost
  winShareNumerator: number; // sum(win_rate * competitive_sessions)
  winShareDenominator: number; // sum of competitive sessions (total_sessions when win_rate != null)
  replyRateNumerator: number; // sum(user_reply_rate * response_count)
  ratingSum: number;
  ratingResponses: number;
  toolSuccessNumerator: number;
  toolSuccessResponses: number;
}

interface SubScoreRollup {
  count: number;
  correctness: { sum: number; n: number };
  completeness: { sum: number; n: number };
  code_quality: { sum: number; n: number };
  clarity: { sum: number; n: number };
  tool_efficiency: { sum: number; n: number };
}

function emptySubScoreRollup(): SubScoreRollup {
  return {
    count: 0,
    correctness: { sum: 0, n: 0 },
    completeness: { sum: 0, n: 0 },
    code_quality: { sum: 0, n: 0 },
    clarity: { sum: 0, n: 0 },
    tool_efficiency: { sum: 0, n: 0 },
  };
}

function addSubScore(
  bucket: { sum: number; n: number },
  value: number | null,
): void {
  if (value == null) return;
  bucket.sum += value;
  bucket.n += 1;
}

function avg(bucket: { sum: number; n: number }): string {
  return bucket.n === 0 ? 'N/A' : (bucket.sum / bucket.n).toFixed(1);
}

function rollupSubScores(rows: GradedLogRow[]): Map<string, SubScoreRollup> {
  const byModel = new Map<string, SubScoreRollup>();
  for (const r of rows) {
    if (!byModel.has(r.model)) byModel.set(r.model, emptySubScoreRollup());
    const b = byModel.get(r.model)!;
    b.count += 1;
    addSubScore(b.correctness, r.score_correctness);
    addSubScore(b.completeness, r.score_completeness);
    addSubScore(b.code_quality, r.score_code_quality);
    addSubScore(b.clarity, r.score_clarity);
    addSubScore(b.tool_efficiency, r.score_tool_efficiency);
  }
  return byModel;
}

export async function generateReport(options: {
  days: number;
}): Promise<string> {
  const now = new Date();
  const since = new Date(
    now.getTime() - options.days * 24 * 60 * 60 * 1000,
  ).toISOString();

  const aggregates = arenaDb.getAggregatesSince(since);
  const gradedLogs = arenaDb.getGradedLogsInRange(since, now.toISOString());

  if (aggregates.length === 0 && gradedLogs.length === 0) {
    return `No arena data for the last ${options.days} days.`;
  }

  // Roll daily aggregates up to one row per model for the window.
  const byModel = new Map<string, ModelRollup>();
  for (const a of aggregates) {
    if (!byModel.has(a.model)) {
      byModel.set(a.model, {
        model: a.model,
        sessions: 0,
        responses: 0,
        weightedScoreSum: 0,
        weightedLatencySum: 0,
        weightedCostSum: 0,
        weightedCostResponses: 0,
        winShareNumerator: 0,
        winShareDenominator: 0,
        replyRateNumerator: 0,
        ratingSum: 0,
        ratingResponses: 0,
        toolSuccessNumerator: 0,
        toolSuccessResponses: 0,
      });
    }
    const r = byModel.get(a.model)!;
    const n = a.response_count ?? 0;
    r.sessions += a.total_sessions;
    r.responses += n;
    if (a.avg_overall_score != null)
      r.weightedScoreSum += a.avg_overall_score * n;
    if (a.avg_latency_ms != null) r.weightedLatencySum += a.avg_latency_ms * n;
    if (a.avg_cost_per_session != null) {
      r.weightedCostSum += a.avg_cost_per_session * n;
      r.weightedCostResponses += n;
    }
    if (a.win_rate != null) {
      r.winShareNumerator += a.win_rate * a.total_sessions;
      r.winShareDenominator += a.total_sessions;
    }
    if (a.user_reply_rate != null)
      r.replyRateNumerator += a.user_reply_rate * n;
    if (a.user_rating_ratio != null) {
      r.ratingSum += a.user_rating_ratio * n;
      r.ratingResponses += n;
    }
    if (a.tool_call_success_rate != null) {
      r.toolSuccessNumerator += a.tool_call_success_rate * n;
      r.toolSuccessResponses += n;
    }
  }

  const rollups = [...byModel.values()].sort((a, b) => {
    const sa = a.responses > 0 ? a.weightedScoreSum / a.responses : 0;
    const sb = b.responses > 0 ? b.weightedScoreSum / b.responses : 0;
    return sb - sa;
  });

  let report = `**Arena Report — Last ${options.days} Days**\n\n`;
  report += `**Model Rankings:**\n`;

  for (let i = 0; i < rollups.length; i++) {
    const m = rollups[i];
    const rank = i + 1;
    const score =
      m.responses > 0 ? (m.weightedScoreSum / m.responses).toFixed(1) : 'N/A';
    const winRate =
      m.winShareDenominator > 0
        ? `${((m.winShareNumerator / m.winShareDenominator) * 100).toFixed(0)}%`
        : 'N/A';
    const cost =
      m.weightedCostResponses > 0
        ? `$${(m.weightedCostSum / m.weightedCostResponses).toFixed(4)}`
        : 'N/A';
    const latency =
      m.responses > 0
        ? `${(m.weightedLatencySum / m.responses).toFixed(0)}ms`
        : 'N/A';

    report += `${rank}. **${m.model}** — avg ${score} | win ${winRate} | ${cost}/session | ${latency} | ${m.sessions} sessions\n`;
  }

  // Quality breakdown — averages per sub-score, computed from raw grades.
  const subScores = rollupSubScores(gradedLogs);
  if (subScores.size > 0) {
    report += `\n**Quality Breakdown (avg sub-scores):**\n`;
    report += `_corr/25 · comp/20 · code/20 · clar/20 · tool/15_\n`;
    const sortedSubs = [...subScores.entries()].sort((a, b) => {
      const sa = rollups.findIndex((r) => r.model === a[0]);
      const sb = rollups.findIndex((r) => r.model === b[0]);
      return (sa === -1 ? 999 : sa) - (sb === -1 ? 999 : sb);
    });
    for (const [model, s] of sortedSubs) {
      report +=
        `${model}: ` +
        `corr ${avg(s.correctness)} · ` +
        `comp ${avg(s.completeness)} · ` +
        `code ${avg(s.code_quality)} · ` +
        `clar ${avg(s.clarity)} · ` +
        `tool ${avg(s.tool_efficiency)}` +
        ` _(${s.count} resp)_\n`;
    }
  }

  // User engagement.
  const anyEngagement = rollups.some(
    (m) => m.replyRateNumerator > 0 || m.ratingResponses > 0,
  );
  if (anyEngagement) {
    report += `\n**User Engagement:**\n`;
    for (const m of rollups) {
      if (m.responses === 0) continue;
      const replyRate = (m.replyRateNumerator / m.responses) * 100;
      let line = `${m.model}: ${replyRate.toFixed(0)}% reply rate`;
      if (m.ratingResponses > 0) {
        const rating = (m.ratingSum / m.ratingResponses) * 100;
        line += ` | ${rating > 0 ? '+' : ''}${rating.toFixed(0)}% rating`;
      }
      if (m.toolSuccessResponses > 0) {
        const toolRate =
          (m.toolSuccessNumerator / m.toolSuccessResponses) * 100;
        line += ` | ${toolRate.toFixed(0)}% tool success`;
      }
      report += `${line}\n`;
    }
  }

  const uniqueSessions = new Set(gradedLogs.map((r) => r.session_id)).size;
  report += `\n_Total sessions: ${uniqueSessions}_`;

  logger.info(
    { days: options.days, models: rollups.length },
    'Arena report generated',
  );
  return report;
}
