/**
 * Arena report generation — weekly + on-demand.
 * Produces Markdown summaries from pre-computed aggregates and raw data.
 */

import * as arenaDb from './arena-db.js';
import { logger } from '../logger.js';

export async function generateReport(options: {
  days: number;
}): Promise<string> {
  const since = new Date(
    Date.now() - options.days * 24 * 60 * 60 * 1000,
  ).toISOString();

  const aggregates = arenaDb.getAggregatesSince(since);

  if (aggregates.length === 0) {
    return `No arena data for the last ${options.days} days.`;
  }

  // Sort by avg score descending
  const sorted = [...aggregates].sort(
    (a, b) => (b.avg_overall_score ?? 0) - (a.avg_overall_score ?? 0),
  );

  let report = `**Arena Report — Last ${options.days} Days**\n\n`;
  report += `**Model Rankings:**\n`;

  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    const rank = i + 1;
    const score = m.avg_overall_score?.toFixed(1) ?? 'N/A';
    const winRate =
      m.win_rate != null ? `${(m.win_rate * 100).toFixed(0)}%` : 'N/A';
    const cost =
      m.avg_cost_per_session != null
        ? `$${m.avg_cost_per_session.toFixed(4)}`
        : 'N/A';
    const latency =
      m.avg_latency_ms != null ? `${m.avg_latency_ms.toFixed(0)}ms` : 'N/A';
    const sessions = m.total_sessions;

    report += `${rank}. **${m.model}** — avg ${score} | win ${winRate} | ${cost}/session | ${latency} | ${sessions} sessions\n`;
  }

  // User engagement
  const totalRatings = sorted.reduce(
    (sum, m) => sum + (m.user_rating_ratio != null ? 1 : 0),
    0,
  );
  if (totalRatings > 0) {
    report += `\n**User Engagement:**\n`;
    for (const m of sorted) {
      if (m.user_reply_rate != null) {
        report += `${m.model}: ${(m.user_reply_rate * 100).toFixed(0)}% reply rate`;
        if (m.user_rating_ratio != null) {
          report += ` | ${m.user_rating_ratio > 0 ? '+' : ''}${(m.user_rating_ratio * 100).toFixed(0)}% rating`;
        }
        report += '\n';
      }
    }
  }

  const totalSessions = sorted.reduce(
    (sum, m) => sum + m.total_sessions,
    0,
  );
  report += `\n_Total sessions: ${totalSessions}_`;

  logger.info({ days: options.days, models: sorted.length }, 'Arena report generated');
  return report;
}
