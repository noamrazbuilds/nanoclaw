/**
 * Google Workspace MCP Server for NanoClaw v2 (container side).
 *
 * Same agent-facing interface + guardrails as v1 (gws_discover / gws_help /
 * gws_run; nonce-confirmed writes; non-main write block; audit log), BUT the
 * gws binary requires glibc 2.39 which the v2 container (bookworm, glibc 2.36)
 * lacks. So instead of shelling out to `gws`, execGws() forwards the parsed
 * args to the HOST gws-proxy over host.docker.internal (the host runs the real
 * binary with creds in ~/.config/gws). Google credentials never enter the
 * container. Decision: gauntlet-logs/gauntlet-2026-06-08-081404.md (Option B).
 *
 * Three tools:
 *   gws_discover  — list services or methods within a service
 *   gws_help      — usage/parameter docs for a command
 *   gws_run       — execute any gws command (with guardrails)
 *
 * Plus TYPED wrappers for the high-frequency operations (sheets_read/update/
 * append/clear, drive_find/get/download, gmail_search/read/send). These take
 * structured params and build the exact, verified gws argv server-side, so the
 * agent cannot misspell flags or guess subcommands — the failure mode behind the
 * 2026-06-15 "gws_run 43% failed" alert (every failure was a CLI arg error, e.g.
 * `--fileId` vs `--params`, `drive files export` of a non-native CSV, dotted
 * `spreadsheets.values`). Building argv directly also avoids the parseCommand
 * quoting bug that split a `--json` body into stray argv tokens. gws_run stays for
 * the long tail / discovery.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// --- Configuration ---

const AUDIT_LOG_DIR = '/workspace/agent/logs';
const AUDIT_LOG_FILE = path.join(AUDIT_LOG_DIR, 'gws-audit.jsonl');
const EXEC_TIMEOUT_MS = 120_000;
const HELP_TIMEOUT_MS = 15_000;
const DISCOVER_TIMEOUT_MS = 30_000;
const NONCE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_OUTPUT_SIZE = 100 * 1024; // 100KB
const IS_MAIN = process.env.NANOCLAW_IS_MAIN === '1';
const IS_SCHEDULED_TASK = process.env.NANOCLAW_IS_SCHEDULED_TASK === '1';

// Host gws-proxy (runs the real gws binary; creds stay host-side).
const GWS_PROXY_URL = process.env.GWS_PROXY_URL || 'http://host.docker.internal:7850';
const GWS_PROXY_TOKEN = process.env.GWS_PROXY_TOKEN || '';

// --- Nonce store for write confirmation ---

const pendingNonces = new Map<string, { command: string; expiresAt: number }>();

function generateNonce(command: string): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  pendingNonces.set(nonce, { command, expiresAt: Date.now() + NONCE_EXPIRY_MS });
  return nonce;
}

function consumeNonce(nonce: string): boolean {
  const entry = pendingNonces.get(nonce);
  if (!entry) return false;
  pendingNonces.delete(nonce);
  if (Date.now() > entry.expiresAt) return false;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of pendingNonces) {
    if (now > entry.expiresAt) pendingNonces.delete(key);
  }
}, 60_000);

// --- Operation classification ---

const WRITE_PATTERNS = [
  'create', 'insert', 'update', 'patch', 'delete', 'remove',
  'trash', 'send', 'modify', 'copy', 'move', 'batchupdate',
  'empty', 'import', 'untrash', 'archive', 'star', 'label',
  'forward', 'reply', 'reply-all',
  '+send', '+reply', '+reply-all', '+forward',
];

const READ_PATTERNS = [
  'list', 'get', 'search', 'query', 'export', 'watch', 'resolve',
  '+read', '+triage', '+watch',
  'discover', 'help', '--help',
];

function classifyOperation(command: string): 'read' | 'write' {
  const lower = command.toLowerCase();
  const tokens = lower.split(/\s+/);
  for (const token of tokens) {
    if (READ_PATTERNS.some((p) => token === p || token.endsWith(p))) return 'read';
  }
  for (const token of tokens) {
    if (WRITE_PATTERNS.some((p) => token === p || token.endsWith(p))) return 'write';
  }
  return 'write'; // safe default
}

// --- Audit logging (container-side; the host proxy keeps the canonical log) ---

interface AuditEntry {
  timestamp: string;
  tool: string;
  command: string;
  classification: 'read' | 'write' | 'discover' | 'help';
  confirmed: boolean | null;
  nonce?: string;
  status: 'success' | 'error' | 'confirmation_required' | 'nonce_invalid';
  duration_ms: number;
  result_size: number;
  error: string | null;
}

function writeAuditLog(entry: AuditEntry): void {
  try {
    fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true });
    fs.appendFileSync(AUDIT_LOG_FILE, JSON.stringify(entry) + '\n');
  } catch {
    /* audit must never break the tool */
  }
}

// --- Command execution — forwards to the host gws-proxy ---

async function execGws(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (!GWS_PROXY_TOKEN) {
    return { stdout: '', stderr: 'GWS_PROXY_TOKEN not configured — GWS unavailable in this group.', exitCode: 1 };
  }
  try {
    const resp = await fetch(`${GWS_PROXY_URL}/gws`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GWS_PROXY_TOKEN}` },
      body: JSON.stringify({ args, meta: { isMain: IS_MAIN, scheduled: IS_SCHEDULED_TASK } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      return { stdout: '', stderr: `gws proxy ${resp.status}: ${t.slice(0, 300)}`, exitCode: 1 };
    }
    const data = (await resp.json()) as { stdout?: string; stderr?: string; exitCode?: number };
    let output = data.stdout || '';
    if (output.length > MAX_OUTPUT_SIZE) {
      output = output.slice(0, MAX_OUTPUT_SIZE) + '\n... [output truncated at 100KB]';
    }
    return { stdout: output, stderr: data.stderr || '', exitCode: typeof data.exitCode === 'number' ? data.exitCode : 0 };
  } catch (err) {
    return { stdout: '', stderr: `gws proxy unreachable: ${err instanceof Error ? err.message : String(err)}`, exitCode: 1 };
  }
}

/** Parse a command string into args, respecting shell quoting. */
function parseCommand(command: string): string[] {
  const args: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && !inSingle) {
      escaped = true;
      continue;
    }
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if ((char === ' ' || char === '\t') && !inSingle && !inDouble) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current.length > 0) args.push(current);
  return args;
}

// --- Shared guarded executor ---
//
// Runs an already-built argv through the same guardrails as gws_run: non-main
// write block, nonce-confirmed writes (scheduled tasks auto-confirm), audit log,
// and result formatting. gws_run and every typed wrapper funnel through here so
// the write-confirmation flow and audit trail are identical regardless of entry
// point. `label` is the human-readable command for the audit log + confirmation
// message; typed wrappers pass a canonical string (the agent never sees raw argv).

interface ToolReply {
  [x: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

async function runGuarded(opts: {
  toolName: string;
  argv: string[];
  label: string;
  classification: 'read' | 'write';
  confirmedNonce?: string;
  timeoutMs: number;
}): Promise<ToolReply> {
  const { toolName, argv, label, classification, confirmedNonce, timeoutMs } = opts;
  const start = Date.now();

  // Non-main groups cannot write (defense against indirect prompt injection).
  if (classification === 'write' && !IS_MAIN) {
    writeAuditLog({
      timestamp: new Date().toISOString(), tool: toolName, command: label, classification: 'write',
      confirmed: false, status: 'error', duration_ms: Date.now() - start, result_size: 0,
      error: 'Write operations blocked for non-main groups',
    });
    return {
      content: [{ type: 'text' as const, text: 'GWS write operations are only available from the main group. Read operations work normally.' }],
      isError: true,
    };
  }

  // Writes require nonce confirmation (scheduled tasks auto-confirm).
  if (classification === 'write' && !IS_SCHEDULED_TASK) {
    if (!confirmedNonce) {
      const nonce = generateNonce(label);
      writeAuditLog({
        timestamp: new Date().toISOString(), tool: toolName, command: label, classification: 'write',
        confirmed: false, nonce, status: 'confirmation_required', duration_ms: Date.now() - start, result_size: 0, error: null,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          status: 'confirmation_required', operation: label, nonce,
          message: 'This write requires confirmation. Describe the action to the user in plain language via send_message (do NOT include this nonce or other protocol details), then after they approve re-call the same tool with confirmed_nonce set to this nonce.',
        }, null, 2) }],
      };
    }
    if (!consumeNonce(confirmedNonce)) {
      writeAuditLog({
        timestamp: new Date().toISOString(), tool: toolName, command: label, classification: 'write',
        confirmed: false, nonce: confirmedNonce, status: 'nonce_invalid', duration_ms: Date.now() - start, result_size: 0,
        error: 'Invalid, expired, or mismatched confirmation nonce',
      });
      return {
        content: [{ type: 'text' as const, text: 'Confirmation failed: invalid/expired nonce. Start the confirmation flow again (call the tool without a nonce).' }],
        isError: true,
      };
    }
  }

  const result = await execGws(argv, timeoutMs);
  writeAuditLog({
    timestamp: new Date().toISOString(), tool: toolName, command: label, classification,
    confirmed: classification === 'write' ? true : null, nonce: confirmedNonce || undefined,
    status: result.exitCode === 0 ? 'success' : 'error', duration_ms: Date.now() - start,
    result_size: result.stdout.length, error: result.exitCode !== 0 ? result.stderr : null,
  });
  if (result.exitCode !== 0) {
    return { content: [{ type: 'text' as const, text: `Command failed (exit ${result.exitCode}):\n${result.stderr}\n${result.stdout}` }], isError: true };
  }
  return { content: [{ type: 'text' as const, text: result.stdout }] };
}

// --- MCP Server ---

const server = new McpServer({ name: 'gws', version: '2.0.0' });

server.tool(
  'gws_discover',
  `List available Google Workspace services, or list methods/commands within a specific service.
Use this to find out what operations are available before calling gws_run.

Examples:
  gws_discover()                    → list all services
  gws_discover({ service: "gmail" }) → list Gmail commands and methods

Available services include: gmail, drive, sheets, calendar, slides, docs, chat, forms, tasks`,
  { service: z.string().optional().describe('Service name to explore (e.g., "gmail", "drive"). Omit to list all.') },
  async (args) => {
    const start = Date.now();
    const gwsArgs = args.service ? [args.service, '--help'] : ['--help'];
    const result = await execGws(gwsArgs, DISCOVER_TIMEOUT_MS);
    writeAuditLog({
      timestamp: new Date().toISOString(),
      tool: 'gws_discover',
      command: args.service || '(all services)',
      classification: 'discover',
      confirmed: null,
      status: result.exitCode === 0 ? 'success' : 'error',
      duration_ms: Date.now() - start,
      result_size: result.stdout.length,
      error: result.exitCode !== 0 ? result.stderr : null,
    });
    const output = result.exitCode === 0 ? result.stdout : `Error (exit ${result.exitCode}):\n${result.stderr}\n${result.stdout}`;
    return { content: [{ type: 'text' as const, text: output }] };
  },
);

server.tool(
  'gws_help',
  `Get detailed help for a specific Google Workspace CLI command, including parameters and usage.

Examples:
  gws_help({ service: "gmail", command: "+send" })
  gws_help({ service: "drive", command: "files list" })`,
  {
    service: z.string().describe('Service name (e.g., "gmail", "drive", "calendar")'),
    command: z.string().optional().describe('Command/method (e.g., "+send", "files list"). Omit for service-level help.'),
  },
  async (args) => {
    const start = Date.now();
    const gwsArgs = [args.service];
    if (args.command) gwsArgs.push(...args.command.split(/\s+/));
    gwsArgs.push('--help');
    const result = await execGws(gwsArgs, HELP_TIMEOUT_MS);
    writeAuditLog({
      timestamp: new Date().toISOString(),
      tool: 'gws_help',
      command: `${args.service} ${args.command || ''}`.trim(),
      classification: 'help',
      confirmed: null,
      status: result.exitCode === 0 ? 'success' : 'error',
      duration_ms: Date.now() - start,
      result_size: result.stdout.length,
      error: result.exitCode !== 0 ? result.stderr : null,
    });
    const output = result.exitCode === 0 ? result.stdout : `Error (exit ${result.exitCode}):\n${result.stderr}\n${result.stdout}`;
    return { content: [{ type: 'text' as const, text: output }] };
  },
);

server.tool(
  'gws_run',
  `Execute any Google Workspace CLI command. Main tool for Gmail/Drive/Sheets/Calendar/etc.

IMPORTANT — WRITE OPERATIONS REQUIRE CONFIRMATION:
A write op (send, create, update, delete, trash, clear, append…) returns a confirmation_required response with a nonce. Re-call gws_run with confirmed_nonce to execute.
• The nonce is an INTERNAL token. NEVER paste it (or other protocol details) into a message to the user — describe the action in plain language (e.g. "Ready to email the daily update to noam@raz.net — ok?"). Pass the nonce only via confirmed_nonce.
• EMAIL sends: ALWAYS confirm with the user (describe recipient/subject/summary via send_message, wait for approval) before re-calling. Never fabricate addresses.
• Other writes the user explicitly requested: the user's request IS the confirmation — re-call with the nonce immediately.
• Risky/self-initiated writes: describe via send_message and wait for approval.

Read ops (list, get, search, +read, +triage) execute immediately.

Examples:
  gws_run({ command: "gmail +triage --query 'is:unread'" })
  gws_run({ command: "sheets spreadsheets values get --params '{\\"spreadsheetId\\":\\"ID\\",\\"range\\":\\"A1:B10\\"}' --format=json" })
  gws_run({ command: "gmail +send --to a@b.com --subject Hi --body Hello" })  (write → needs nonce)`,
  {
    command: z.string().describe('The gws command (without the "gws" prefix).'),
    confirmed_nonce: z.string().optional().describe('Nonce from a prior confirmation_required response. Required for write ops.'),
  },
  async (args) => {
    let command = args.command;
    let confirmedNonce = args.confirmed_nonce;
    if (!confirmedNonce) {
      const nonceInCmd = command.match(/--confirmed_nonce\s+([a-f0-9]{32})/);
      if (nonceInCmd) {
        confirmedNonce = nonceInCmd[1];
        command = command.replace(/\s*--confirmed_nonce\s+[a-f0-9]{32}/, '').trim();
      }
    }

    const classification = classifyOperation(command);
    const gwsArgs = parseCommand(command);
    return runGuarded({ toolName: 'gws_run', argv: gwsArgs, label: command, classification, confirmedNonce, timeoutMs: EXEC_TIMEOUT_MS });
  },
);

// --- Typed wrappers (verified gws argv built server-side; agent fills params) ---
//
// Prefer these over gws_run for the operations they cover. The agent supplies
// structured params; the wrapper builds the exact, correct gws invocation. Writes
// flow through the same nonce-confirmation guardrail as gws_run.

const WRITE_CONFIRM_NOTE =
  'WRITE: returns confirmation_required with a nonce on first call — describe the action to the user in plain language (never paste the nonce), then re-call with confirmed_nonce. Scheduled tasks auto-confirm.';

server.tool(
  'sheets_read',
  `Read a range from a Google Sheet. Returns JSON rows. (read)
Example: sheets_read({ spreadsheetId: "1ABC...", range: "Upcoming Concerts!A:H" })`,
  {
    spreadsheetId: z.string().describe('The spreadsheet ID (from its URL).'),
    range: z.string().describe("A1 range, including the tab name, e.g. \"Sheet1!A1:H100\" or \"'Tab With Spaces'!A:H\"."),
  },
  async (args) => {
    const params = JSON.stringify({ spreadsheetId: args.spreadsheetId, range: args.range });
    return runGuarded({
      toolName: 'sheets_read',
      argv: ['sheets', 'spreadsheets', 'values', 'get', '--params', params, '--format=json'],
      label: `sheets_read ${args.spreadsheetId} ${args.range}`,
      classification: 'read', timeoutMs: EXEC_TIMEOUT_MS,
    });
  },
);

server.tool(
  'sheets_update',
  `Overwrite cells in a Google Sheet starting at a range. ${WRITE_CONFIRM_NOTE}
Example: sheets_update({ spreadsheetId: "1ABC...", range: "Sheet1!A2", values: [["a","b"],["c","d"]] })`,
  {
    spreadsheetId: z.string().describe('The spreadsheet ID.'),
    range: z.string().describe('A1 range (top-left anchor), including tab name.'),
    values: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).describe('2D array of row values.'),
    valueInputOption: z.enum(['RAW', 'USER_ENTERED']).optional().describe('Default RAW. USER_ENTERED parses formulas/dates.'),
    confirmed_nonce: z.string().optional().describe('Nonce from a prior confirmation_required response.'),
  },
  async (args) => {
    const params = JSON.stringify({ spreadsheetId: args.spreadsheetId, range: args.range, valueInputOption: args.valueInputOption ?? 'RAW' });
    const body = JSON.stringify({ values: args.values });
    return runGuarded({
      toolName: 'sheets_update',
      argv: ['sheets', 'spreadsheets', 'values', 'update', '--params', params, '--json', body],
      label: `sheets_update ${args.spreadsheetId} ${args.range} (${args.values.length} rows)`,
      classification: 'write', confirmedNonce: args.confirmed_nonce, timeoutMs: EXEC_TIMEOUT_MS,
    });
  },
);

server.tool(
  'sheets_append',
  `Append rows after the last row of data in a range. ${WRITE_CONFIRM_NOTE}
Example: sheets_append({ spreadsheetId: "1ABC...", range: "Sheet1!A:H", values: [["x","y"]] })`,
  {
    spreadsheetId: z.string().describe('The spreadsheet ID.'),
    range: z.string().describe('A1 range identifying the table to append to, including tab name.'),
    values: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).describe('2D array of row values.'),
    valueInputOption: z.enum(['RAW', 'USER_ENTERED']).optional().describe('Default RAW.'),
    confirmed_nonce: z.string().optional(),
  },
  async (args) => {
    const params = JSON.stringify({
      spreadsheetId: args.spreadsheetId, range: args.range,
      valueInputOption: args.valueInputOption ?? 'RAW', insertDataOption: 'INSERT_ROWS',
    });
    const body = JSON.stringify({ values: args.values });
    return runGuarded({
      toolName: 'sheets_append',
      argv: ['sheets', 'spreadsheets', 'values', 'append', '--params', params, '--json', body],
      label: `sheets_append ${args.spreadsheetId} ${args.range} (${args.values.length} rows)`,
      classification: 'write', confirmedNonce: args.confirmed_nonce, timeoutMs: EXEC_TIMEOUT_MS,
    });
  },
);

server.tool(
  'sheets_clear',
  `Clear cell VALUES in a range without deleting the sheet/file. Use this to reset a tab. ${WRITE_CONFIRM_NOTE}
Example: sheets_clear({ spreadsheetId: "1ABC...", range: "Sheet1!A2:H" })`,
  {
    spreadsheetId: z.string().describe('The spreadsheet ID.'),
    range: z.string().describe('A1 range to clear, including tab name.'),
    confirmed_nonce: z.string().optional(),
  },
  async (args) => {
    const params = JSON.stringify({ spreadsheetId: args.spreadsheetId, range: args.range });
    return runGuarded({
      toolName: 'sheets_clear',
      argv: ['sheets', 'spreadsheets', 'values', 'clear', '--params', params],
      label: `sheets_clear ${args.spreadsheetId} ${args.range}`,
      classification: 'write', confirmedNonce: args.confirmed_nonce, timeoutMs: EXEC_TIMEOUT_MS,
    });
  },
);

server.tool(
  'drive_find',
  `Search Drive for files. Returns JSON {files:[{id,name,mimeType,...}]}. (read)
Example: drive_find({ query: "name contains 'birthday'" })`,
  {
    query: z.string().describe("Drive query (q syntax), e.g. \"name contains 'report'\" or \"'FOLDER_ID' in parents\"."),
    pageSize: z.number().int().min(1).max(100).optional().describe('Max files to return (default 25).'),
    fields: z.string().optional().describe("Optional partial-response fields, e.g. \"files(id,name,mimeType)\"."),
  },
  async (args) => {
    const p: Record<string, unknown> = { q: args.query, pageSize: args.pageSize ?? 25 };
    if (args.fields) p.fields = args.fields;
    return runGuarded({
      toolName: 'drive_find',
      argv: ['drive', 'files', 'list', '--params', JSON.stringify(p), '--format=json'],
      label: `drive_find ${args.query}`,
      classification: 'read', timeoutMs: EXEC_TIMEOUT_MS,
    });
  },
);

server.tool(
  'drive_get',
  `Get a Drive file's metadata by ID. (read)
Example: drive_get({ fileId: "14vR...", fields: "id,name,mimeType,size,trashed" })`,
  {
    fileId: z.string().describe('The Drive file ID.'),
    fields: z.string().optional().describe('Metadata fields (default "id,name,mimeType,size,trashed,modifiedTime").'),
  },
  async (args) => {
    const params = JSON.stringify({ fileId: args.fileId, fields: args.fields ?? 'id,name,mimeType,size,trashed,modifiedTime' });
    return runGuarded({
      toolName: 'drive_get',
      argv: ['drive', 'files', 'get', '--params', params, '--format=json'],
      label: `drive_get ${args.fileId}`,
      classification: 'read', timeoutMs: EXEC_TIMEOUT_MS,
    });
  },
);

server.tool(
  'drive_download',
  `Download a file's CONTENT to a path. Use for non-Google files (CSV, PDF, images). Do NOT use Drive "export" for these — that only works on native Docs/Sheets/Slides. (read)
Example: drive_download({ fileId: "14vR...", output: "birthday_list.csv" })`,
  {
    fileId: z.string().describe('The Drive file ID.'),
    output: z.string().describe('Output path. Must be relative to the working dir (e.g. "data.csv" or "subdir/data.csv").'),
  },
  async (args) => {
    const params = JSON.stringify({ fileId: args.fileId, alt: 'media' });
    return runGuarded({
      toolName: 'drive_download',
      argv: ['drive', 'files', 'get', '--params', params, '-o', args.output],
      label: `drive_download ${args.fileId} -> ${args.output}`,
      classification: 'read', timeoutMs: EXEC_TIMEOUT_MS,
    });
  },
);

server.tool(
  'gmail_search',
  `Search Gmail messages. Returns JSON {messages:[{id,threadId}]} — follow with gmail_read for content. (read)
Example: gmail_search({ query: "from:ticketmaster.com is:unread", maxResults: 20 })`,
  {
    query: z.string().describe('Gmail search query (same syntax as the Gmail search box).'),
    maxResults: z.number().int().min(1).max(100).optional().describe('Max messages (default 20).'),
  },
  async (args) => {
    const params = JSON.stringify({ userId: 'me', q: args.query, maxResults: args.maxResults ?? 20 });
    return runGuarded({
      toolName: 'gmail_search',
      argv: ['gmail', 'users', 'messages', 'list', '--params', params, '--format=json'],
      label: `gmail_search ${args.query}`,
      classification: 'read', timeoutMs: EXEC_TIMEOUT_MS,
    });
  },
);

server.tool(
  'gmail_read',
  `Read a Gmail message by ID (sender, subject, date, body). (read)
Example: gmail_read({ id: "19ecbd1db1022ecd" })`,
  { id: z.string().describe('The Gmail message ID (from gmail_search).') },
  async (args) => {
    return runGuarded({
      toolName: 'gmail_read',
      argv: ['gmail', '+read', '--id', args.id],
      label: `gmail_read ${args.id}`,
      classification: 'read', timeoutMs: EXEC_TIMEOUT_MS,
    });
  },
);

server.tool(
  'gmail_send',
  `Send an email. ${WRITE_CONFIRM_NOTE} ALWAYS confirm recipient/subject with the user first — never fabricate addresses.
Example: gmail_send({ to: "a@b.com", subject: "Hi", body: "Line1\\nLine2" })`,
  {
    to: z.string().describe('Recipient address(es), comma-separated.'),
    subject: z.string().describe('Subject line.'),
    body: z.string().describe('Plain-text body (use \\n for line breaks).'),
    cc: z.string().optional().describe('CC address(es), comma-separated.'),
    bcc: z.string().optional().describe('BCC address(es), comma-separated.'),
    confirmed_nonce: z.string().optional(),
  },
  async (args) => {
    const argv = ['gmail', '+send', '--to', args.to, '--subject', args.subject, '--body', args.body];
    if (args.cc) argv.push('--cc', args.cc);
    if (args.bcc) argv.push('--bcc', args.bcc);
    return runGuarded({
      toolName: 'gmail_send',
      argv,
      label: `gmail_send to=${args.to} subject="${args.subject}"`,
      classification: 'write', confirmedNonce: args.confirmed_nonce, timeoutMs: EXEC_TIMEOUT_MS,
    });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
