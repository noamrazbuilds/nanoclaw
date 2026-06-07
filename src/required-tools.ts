/**
 * C6 honest-failure enforcement — shared check logic.
 *
 * A scheduled task may declare `required_tools` in its content JSON: tools that
 * MUST be successfully invoked for the run to count as a real success. The
 * tool-call ledger (C5, written by the runtime PostToolUse hooks — not the
 * model) is checked against this declaration; if a required tool was never
 * invoked, the run is a fabrication regardless of what the agent's summary says.
 *
 * Tasks WITHOUT `required_tools` are lenient (no enforcement) — strict-by-default
 * would break every legacy task on cutover.
 *
 * NOTE: this file is intentionally duplicated in container/agent-runner/src/
 * (the host is Node, the container is Bun — they share no modules). Keep the two
 * copies in sync.
 */
export interface RequiredTool {
  /** Matched against the tool name in the ledger: substring (default) or regex. */
  op_match: string;
  /** Minimum number of SUCCESSFUL invocations required. Default 1. */
  min_success?: number;
  /** 'regex' → op_match is a RegExp source; otherwise a substring match. */
  match?: 'exact' | 'regex';
}

export interface LedgerCall {
  tool: string;
  status: string; // 'success' | 'failure'
}

/** Parse a task's required-tools declaration from its content JSON. [] when absent/malformed (→ lenient). */
export function parseRequiredTools(content: string): RequiredTool[] {
  try {
    const parsed = JSON.parse(content) as { required_tools?: unknown };
    const rt = parsed.required_tools;
    if (!Array.isArray(rt)) return [];
    return rt.filter((r): r is RequiredTool => !!r && typeof (r as RequiredTool).op_match === 'string');
  } catch {
    return [];
  }
}

/**
 * Return the op_match strings whose minimum successful-invocation count was NOT
 * met by the ledger. Empty array → all requirements satisfied (or none declared).
 */
export function unmetRequiredTools(calls: LedgerCall[], required: RequiredTool[]): string[] {
  const unmet: string[] = [];
  for (const r of required) {
    const need = r.min_success ?? 1;
    let matches: (t: string) => boolean;
    if (r.match === 'regex') {
      try {
        const re = new RegExp(r.op_match);
        matches = (t) => re.test(t);
      } catch {
        matches = (t) => t.includes(r.op_match);
      }
    } else {
      matches = (t) => t.includes(r.op_match);
    }
    const got = calls.filter((c) => c.status === 'success' && matches(c.tool)).length;
    if (got < need) unmet.push(r.op_match);
  }
  return unmet;
}
