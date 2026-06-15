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
    const start = Date.now();
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

    // Non-main groups cannot write (defense against indirect prompt injection).
    if (classification === 'write' && !IS_MAIN) {
      writeAuditLog({
        timestamp: new Date().toISOString(), tool: 'gws_run', command, classification: 'write',
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
        const nonce = generateNonce(command);
        writeAuditLog({
          timestamp: new Date().toISOString(), tool: 'gws_run', command, classification: 'write',
          confirmed: false, nonce, status: 'confirmation_required', duration_ms: Date.now() - start, result_size: 0, error: null,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            status: 'confirmation_required', operation: command, nonce,
            message: 'This write requires confirmation. Describe the action to the user in plain language via send_message (do NOT include this nonce or other protocol details), then after they approve re-call gws_run with confirmed_nonce set to this nonce.',
          }, null, 2) }],
        };
      }
      if (!consumeNonce(confirmedNonce)) {
        writeAuditLog({
          timestamp: new Date().toISOString(), tool: 'gws_run', command, classification: 'write',
          confirmed: false, nonce: confirmedNonce, status: 'nonce_invalid', duration_ms: Date.now() - start, result_size: 0,
          error: 'Invalid, expired, or mismatched confirmation nonce',
        });
        return {
          content: [{ type: 'text' as const, text: 'Confirmation failed: invalid/expired nonce. Start the confirmation flow again (call gws_run without a nonce).' }],
          isError: true,
        };
      }
    }

    const result = await execGws(gwsArgs, EXEC_TIMEOUT_MS);
    writeAuditLog({
      timestamp: new Date().toISOString(), tool: 'gws_run', command, classification,
      confirmed: classification === 'write' ? true : null, nonce: confirmedNonce || undefined,
      status: result.exitCode === 0 ? 'success' : 'error', duration_ms: Date.now() - start,
      result_size: result.stdout.length, error: result.exitCode !== 0 ? result.stderr : null,
    });
    if (result.exitCode !== 0) {
      return { content: [{ type: 'text' as const, text: `Command failed (exit ${result.exitCode}):\n${result.stderr}\n${result.stdout}` }], isError: true };
    }
    return { content: [{ type: 'text' as const, text: result.stdout }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
