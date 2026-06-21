/**
 * sync-task-prompts.ts — materialize version-controlled task prompts into the
 * live scheduled-task rows.
 *
 * Canonical source of truth for NanoClaw's recurring task prompts lives as
 * plain files in the PKA vault (git-tracked + Syncthing-synced, excluded from
 * PKA indexing):
 *
 *   <TASKS_ROOT>/<group-folder>/<slug>.md     — the task PROMPT (verbatim markdown)
 *   <TASKS_ROOT>/<group-folder>/<slug>.json   — sidecar metadata (series_id, recurrence,
 *                                               model, suppress_chat_output, script?, required_tools?, ...)
 *
 * This script reads those files and updates the matching LIVE pending task rows
 * (`messages_in` with kind='task') in each agent group's ACTIVE sessions. It is
 * the same "canonical store → materialize for the consumer" pattern NanoClaw
 * uses for container.json. The runtime is unchanged: tasks still execute from
 * the DB, so no new fire-time failure surface is introduced.
 *
 * Design guarantees (this codebase has been bitten by silent failures):
 *  - Idempotent: re-running with no file change writes nothing.
 *  - Loud: a missing file of a pair, invalid sidecar JSON, an unparseable
 *    existing row, or a series with no live pending row is reported as an ERROR
 *    and makes the run exit non-zero — never a silent skip.
 *  - --dry-run: print the diff, write nothing.
 *  - The series_id in the sidecar is the join key; the slug/filename is cosmetic.
 *
 * Usage:
 *   pnpm exec tsx scripts/sync-task-prompts.ts [--dry-run] [--root <dir>] [--quiet]
 *
 * Default root: $NANOCLAW_TASKS_ROOT or ~/pka/vault/nanoclaw/tasks
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { DATA_DIR } from '../src/config.js';

/**
 * Plain-text Telegram alert on sync failure — a failed sync is otherwise
 * unwatched telemetry (the edit silently doesn't land; the old prompt keeps
 * firing). Mirrors the plain-text, no-parse_mode pattern of the other host
 * monitors (tool_health.py, task_liveness.py). Best-effort; never throws.
 */
async function tgAlert(text: string): Promise<void> {
  try {
    const envText = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
    const env: Record<string, string> = {};
    for (const line of envText.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2];
    }
    const token = process.env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN;
    const chat = process.env.WATCHDOG_ALERT_CHAT_ID || env.WATCHDOG_ALERT_CHAT_ID || '145958767';
    if (!token) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    /* alerting is best-effort */
  }
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const QUIET = args.includes('--quiet');
const rootFlagIdx = args.indexOf('--root');
const TASKS_ROOT =
  (rootFlagIdx >= 0 ? args[rootFlagIdx + 1] : undefined) ||
  process.env.NANOCLAW_TASKS_ROOT ||
  path.join(os.homedir(), 'pka', 'vault', 'nanoclaw', 'tasks');

let errors = 0;
let updated = 0;
let unchanged = 0;

function log(msg: string): void {
  if (!QUIET) console.log(msg);
}
function fail(msg: string): void {
  console.error(`ERROR: ${msg}`);
  errors++;
}

interface Sidecar {
  series_id: string;
  label?: string;
  recurrence?: string | null;
  model?: string | null;
  suppress_chat_output?: boolean;
  script?: string | null;
  required_tools?: unknown;
  migrated_from_v1?: unknown;
}

/** Build the canonical messages_in.content JSON from a prompt + sidecar. */
function buildContent(prompt: string, meta: Sidecar): string {
  const content: Record<string, unknown> = { prompt };
  // Preserve the fields the runtime reads; omit absent ones to match how tasks
  // are stored (don't invent keys).
  if (meta.script !== undefined) content.script = meta.script;
  if (meta.model !== undefined && meta.model !== null) content.model = meta.model;
  content.suppress_chat_output = meta.suppress_chat_output === true;
  if (meta.required_tools !== undefined) content.required_tools = meta.required_tools;
  if (meta.migrated_from_v1 !== undefined) content.migrated_from_v1 = meta.migrated_from_v1;
  return JSON.stringify(content);
}

/**
 * Semantic fingerprint of a task's content for change detection. Compares MEANING,
 * not byte-for-byte JSON — so cosmetic-only differences (key order, `script:null`
 * vs absent — the runtime treats both as "no script", see task-script.ts) don't
 * cause spurious rewrites. Only a real change to prompt / model / suppress /
 * script / required_tools triggers an update.
 */
function contentFingerprint(content: string): string {
  let c: Record<string, unknown> = {};
  try {
    c = JSON.parse(content);
  } catch {
    return `__unparseable__:${content}`; // any change away from corrupt counts as a change
  }
  return JSON.stringify({
    prompt: typeof c.prompt === 'string' ? c.prompt : '',
    model: c.model ?? null,
    suppress_chat_output: c.suppress_chat_output === true,
    script: typeof c.script === 'string' ? c.script : null,
    required_tools: c.required_tools ?? null,
  });
}

function activeSessionDirs(central: Database.Database, groupId: string): string[] {
  const rows = central
    .prepare("SELECT id FROM sessions WHERE agent_group_id = ? AND status = 'active'")
    .all(groupId) as Array<{ id: string }>;
  return rows.map((r) => path.join(DATA_DIR, 'v2-sessions', groupId, r.id, 'inbound.db')).filter((p) => fs.existsSync(p));
}

function syncGroup(central: Database.Database, groupFolder: string, dir: string): void {
  const group = central.prepare('SELECT id FROM agent_groups WHERE folder = ?').get(groupFolder) as
    | { id: string }
    | undefined;
  if (!group) {
    fail(`no agent_group with folder='${groupFolder}' (dir ${dir})`);
    return;
  }
  const sessionDbs = activeSessionDirs(central, group.id);
  if (sessionDbs.length === 0) {
    fail(`agent group '${groupFolder}' has no active session — cannot sync its tasks`);
    return;
  }

  // Orphan check (BOTH directions). The md->json direction is handled per-file in
  // the loop below; this catches the reverse — a <slug>.json with NO <slug>.md.
  // That asymmetry was a real blind spot: a task prompt (pka-inbox-review-afternoon.md)
  // was silently deleted by an over-broad `git add -A` in a synced-vault consolidation
  // commit, leaving an orphaned .json. Because sync only iterated .md files, the
  // deletion produced no error — the task just kept running a stale DB prompt forever.
  // Fail loudly so a vanished prompt surfaces on the very next sync instead of rotting.
  const allFiles = fs.readdirSync(dir);
  const mdSlugs = new Set(
    allFiles.filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => f.slice(0, -3)),
  );
  for (const jsonFile of allFiles.filter((f) => f.endsWith('.json'))) {
    const slug = jsonFile.slice(0, -5);
    if (!mdSlugs.has(slug)) {
      fail(
        `${groupFolder}/${jsonFile} has no prompt ${slug}.md — the .md was likely deleted ` +
          `(check git history / Syncthing). Restore it or remove the orphaned sidecar.`,
      );
    }
  }

  // Pair up <slug>.md + <slug>.json
  const mdFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md');
  for (const md of mdFiles) {
    const slug = md.slice(0, -3);
    const mdPath = path.join(dir, md);
    const jsonPath = path.join(dir, `${slug}.json`);
    if (!fs.existsSync(jsonPath)) {
      fail(`${groupFolder}/${md} has no sidecar ${slug}.json`);
      continue;
    }
    let meta: Sidecar;
    try {
      meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch (e) {
      fail(`${groupFolder}/${slug}.json is not valid JSON: ${(e as Error).message}`);
      continue;
    }
    if (!meta.series_id) {
      fail(`${groupFolder}/${slug}.json is missing required field series_id`);
      continue;
    }
    const prompt = fs.readFileSync(mdPath, 'utf8');
    const wantContent = buildContent(prompt, meta);
    JSON.parse(wantContent); // guard: never write content we can't re-parse
    const wantRecurrence = meta.recurrence ?? null;

    // Update the live pending rows for this series across every active session.
    let matchedRows = 0;
    for (const dbPath of sessionDbs) {
      const db = new Database(dbPath);
      try {
        db.pragma('busy_timeout = 5000');
        const rows = db
          .prepare(
            "SELECT id, content, recurrence FROM messages_in WHERE kind='task' AND status='pending' AND (series_id = ? OR id = ?)",
          )
          .all(meta.series_id, meta.series_id) as Array<{ id: string; content: string; recurrence: string | null }>;
        const wantFingerprint = contentFingerprint(wantContent);
        for (const row of rows) {
          matchedRows++;
          const contentChanged = contentFingerprint(row.content) !== wantFingerprint;
          const recurrenceChanged = (row.recurrence ?? null) !== wantRecurrence;
          if (!contentChanged && !recurrenceChanged) {
            unchanged++;
            continue;
          }
          const changes: string[] = [];
          if (contentChanged) changes.push('prompt/meta');
          if (recurrenceChanged) changes.push(`recurrence ${row.recurrence ?? 'null'}→${wantRecurrence ?? 'null'}`);
          log(`  ${DRY_RUN ? '[dry-run] would update' : 'updating'} ${slug} (${row.id}): ${changes.join(', ')}`);
          if (!DRY_RUN) {
            db.prepare('UPDATE messages_in SET content = ?, recurrence = ? WHERE id = ?').run(
              wantContent,
              wantRecurrence,
              row.id,
            );
            // verify read-back parses
            const back = db.prepare('SELECT content FROM messages_in WHERE id = ?').get(row.id) as { content: string };
            JSON.parse(back.content);
          }
          updated++;
        }
      } finally {
        db.close();
      }
    }
    if (matchedRows === 0) {
      fail(`${groupFolder}/${slug}: no live pending task row found for series_id=${meta.series_id}`);
    }
  }
}

async function main(): Promise<void> {
  if (!fs.existsSync(TASKS_ROOT)) {
    fail(`tasks root does not exist: ${TASKS_ROOT}`);
    await tgAlert(`🔧 NanoClaw task-sync FAILED: tasks root missing (${TASKS_ROOT}). Task-prompt edits are not syncing.`);
    process.exit(1);
  }
  const central = new Database(path.join(DATA_DIR, 'v2.db'), { readonly: false });
  try {
    const groupDirs = fs
      .readdirSync(TASKS_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    if (groupDirs.length === 0) fail(`no group folders under ${TASKS_ROOT}`);
    log(`sync-task-prompts: root=${TASKS_ROOT}${DRY_RUN ? ' (dry-run)' : ''}, groups=[${groupDirs.join(', ')}]`);
    for (const g of groupDirs) {
      syncGroup(central, g, path.join(TASKS_ROOT, g));
    }
  } finally {
    central.close();
  }
  // Always emit the summary (a liveness line in the log even on a clean run) —
  // logs are forensic; a clean run that wrote nothing should still leave a tick.
  const summary = `Done: ${updated} updated, ${unchanged} unchanged, ${errors} error(s)${DRY_RUN ? ' (dry-run — nothing written)' : ''}`;
  console.log(summary);
  if (errors > 0 && !DRY_RUN) {
    await tgAlert(
      `🔧 NanoClaw task-sync had ${errors} error(s) — some scheduled-task prompt edits did NOT sync to the live tasks. ` +
        `The previous prompt keeps firing until fixed. Check logs/task-sync.log and run: pnpm exec tsx scripts/sync-task-prompts.ts --dry-run`,
    );
  }
  process.exit(errors > 0 ? 1 : 0);
}

main();
