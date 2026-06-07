/**
 * C6 honest-failure enforcement — host-side backstop (defense-in-depth).
 *
 * The container-side gate (poll-loop) is the primary prevention: it replaces a
 * fabricated success with an honest-failure error before it reaches the user.
 * This host backstop is the independent audit layer the gauntlet (Option C)
 * called for — it re-checks the runtime tool-call ledger against each completed
 * task's declared required_tools and records an honest-failure entry in the
 * central task_audit_log when a required tool wasn't successfully invoked.
 *
 * Why both: the container can't write the central audit log; and the backstop
 * catches cases the gate can't — a container crash (gate never ran) or a bug in
 * the gate itself. Undeclared tasks are lenient (no enforcement).
 */
import type Database from 'better-sqlite3';

import { getToolCalls } from '../../db/session-db.js';
import { log } from '../../log.js';
import { parseRequiredTools, unmetRequiredTools } from '../../required-tools.js';
import { logTaskAudit } from './db.js';

export function runHonestFailureBackstop(
  inDb: Database.Database,
  outDb: Database.Database,
  transitionedIds: string[],
): void {
  for (const id of transitionedIds) {
    let row: { kind: string; content: string; timestamp: string } | undefined;
    try {
      row = inDb.prepare('SELECT kind, content, timestamp FROM messages_in WHERE id = ?').get(id) as
        | { kind: string; content: string; timestamp: string }
        | undefined;
    } catch {
      continue;
    }
    if (!row || row.kind !== 'task') continue;

    const required = parseRequiredTools(row.content);
    if (required.length === 0) continue; // lenient — undeclared tasks aren't enforced

    // Scope the ledger to this run: tool calls since the task row's timestamp.
    // Precise enough — each session has its own outbound.db and turns run
    // sequentially (a task message's run is the activity after its creation).
    const unmet = unmetRequiredTools(getToolCalls(outDb, { since: row.timestamp }), required);
    if (unmet.length === 0) continue;

    log.warn('C6 honest-failure backstop: task completed without invoking required tool(s)', {
      taskId: id,
      unmet,
    });
    logTaskAudit(id, 'honest-failure', 'host-backstop', null, JSON.stringify({ unmet }));
  }
}
