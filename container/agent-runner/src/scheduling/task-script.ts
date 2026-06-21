import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { MessageInRow } from '../db/messages-in.js';
import { touchHeartbeat } from '../db/connection.js';
import { writeMessageOut } from '../db/messages-out.js';

const SCRIPT_TIMEOUT_MS = 30_000;
const SCRIPT_MAX_BUFFER = 1024 * 1024;

export interface ScriptResult {
  wakeAgent: boolean;
  data?: unknown;
  /**
   * Optional user-facing messages the script wants delivered WITHOUT waking the
   * agent. applyPreTaskScripts enqueues each to the task's own destination via the
   * normal outbound→host-delivery path. This is the "script outbox": a fully
   * deterministic recurring task (fetch → format → notify) needs no LLM at all —
   * it returns wakeAgent:false plus the message(s) to send. Empty/blank texts are
   * ignored. Routing always uses the task row's destination (the script cannot
   * pick arbitrary recipients).
   */
  send?: { text: string }[];
}

function genOutId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function log(msg: string): void {
  console.error(`[task-script] ${msg}`);
}

export async function runScript(script: string, taskId: string): Promise<ScriptResult | null> {
  // Pick the interpreter from the shebang. A Python-shebang script run through
  // `bash` errors on its first `import` line (bash: "import: command not found"),
  // produces no JSON on stdout, and the task is silently skipped — so a script
  // MUST be run with the interpreter it was written for. Default to bash for
  // shebang-less scripts (e.g. `python3 -c "..."` one-liners, plain shell).
  const firstLine = script.slice(0, script.indexOf('\n') === -1 ? undefined : script.indexOf('\n'));
  const isPython = /^#!.*\bpython/.test(firstLine);
  const interpreter = isPython ? 'python3' : 'bash';
  const scriptPath = path.join('/tmp', `task-script-${taskId}.${isPython ? 'py' : 'sh'}`);
  fs.writeFileSync(scriptPath, script, { mode: 0o755 });

  return new Promise((resolve) => {
    execFile(
      interpreter,
      [scriptPath],
      { timeout: SCRIPT_TIMEOUT_MS, maxBuffer: SCRIPT_MAX_BUFFER, env: process.env },
      (error, stdout, stderr) => {
        try {
          fs.unlinkSync(scriptPath);
        } catch {
          /* best-effort cleanup */
        }

        if (stderr) {
          log(`[${taskId}] stderr: ${stderr.slice(0, 500)}`);
        }

        if (error) {
          log(`[${taskId}] error: ${error.message}`);
          return resolve(null);
        }

        const lines = stdout.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        if (!lastLine) {
          log(`[${taskId}] no output`);
          return resolve(null);
        }

        try {
          const result = JSON.parse(lastLine);
          if (typeof result.wakeAgent !== 'boolean') {
            log(`[${taskId}] output missing wakeAgent boolean: ${lastLine.slice(0, 200)}`);
            return resolve(null);
          }
          resolve(result as ScriptResult);
        } catch {
          log(`[${taskId}] output is not valid JSON: ${lastLine.slice(0, 200)}`);
          resolve(null);
        }
      },
    );
  });
}

export interface TaskScriptOutcome {
  keep: MessageInRow[];
  skipped: string[];
}

/**
 * Run pre-task scripts for any task messages that carry one, serially.
 * - Errors / missing output / wakeAgent=false → task id added to `skipped`.
 * - wakeAgent=true → content JSON is mutated to carry `scriptOutput`, so the
 *   formatter renders it into the prompt.
 * Non-task messages and tasks without scripts pass through unchanged.
 */
export async function applyPreTaskScripts(messages: MessageInRow[]): Promise<TaskScriptOutcome> {
  const keep: MessageInRow[] = [];
  const skipped: string[] = [];

  for (const msg of messages) {
    if (msg.kind !== 'task') {
      keep.push(msg);
      continue;
    }

    let content: Record<string, unknown>;
    try {
      content = JSON.parse(msg.content);
    } catch {
      keep.push(msg);
      continue;
    }

    const script = typeof content.script === 'string' ? (content.script as string) : null;
    if (!script) {
      keep.push(msg);
      continue;
    }

    log(`running script for task ${msg.id}`);
    touchHeartbeat();
    const result = await runScript(script, msg.id);
    touchHeartbeat();

    // Script outbox: deliver any script-emitted messages to the task's own
    // destination, whether or not the agent is also woken. Fully deterministic —
    // no Claude call. Best-effort per message; a write failure is logged, never
    // silently swallows the rest.
    if (result && Array.isArray(result.send)) {
      for (const m of result.send) {
        const text = m && typeof m.text === 'string' ? m.text.trim() : '';
        if (!text) continue;
        try {
          writeMessageOut({
            id: genOutId(),
            kind: 'chat',
            platform_id: msg.platform_id,
            channel_type: msg.channel_type,
            thread_id: msg.thread_id,
            content: JSON.stringify({ text }),
          });
          log(`task ${msg.id} script enqueued a message (${text.length} chars)`);
        } catch (e) {
          log(`task ${msg.id} script outbox write failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    if (!result || !result.wakeAgent) {
      const reason = result ? 'wakeAgent=false' : 'script error/no output';
      log(`task ${msg.id} skipped: ${reason}`);
      skipped.push(msg.id);
      continue;
    }

    log(`task ${msg.id} wakeAgent=true, enriching prompt`);
    content.scriptOutput = result.data ?? null;
    keep.push({ ...msg, content: JSON.stringify(content) });
  }

  return { keep, skipped };
}
