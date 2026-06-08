/**
 * GWS host-side proxy (gauntlet-decided 2026-06-08, gauntlet-logs/gauntlet-2026-06-08-081404.md).
 *
 * Why this exists: the `gws` CLI is a prebuilt Rust binary requiring GLIBC_2.39;
 * v2 agent containers (node:22-slim = Debian bookworm = glibc 2.36) cannot run
 * it, and there is no x86_64 musl build. Rather than change the container base
 * image (high blast radius) and replicate Google credentials into every
 * container, the host — which already has gws working + authenticated in
 * ~/.config/gws — runs the binary, and the in-container GWS MCP server forwards
 * commands here over host.docker.internal (the same pattern as the OneCLI
 * gateway + LiteLLM).
 *
 * Security posture:
 *  - Binds to the Docker bridge gateway (172.17.0.1), NOT 0.0.0.0 — unreachable
 *    from the public internet even if the firewall is misconfigured.
 *  - Bearer token (GWS_PROXY_TOKEN, ≥32 chars) — a proxy auth token, NOT a
 *    Google credential. Injected into containers that need GWS.
 *  - Service allowlist + forbidden-flag block + execFile (no shell) →
 *    no shell injection, no auth/config-altering flags, no unknown services.
 *  - Serialized execution (gws token-refresh writes ~/.config/gws — avoid races).
 *  - Canonical, host-verified append-only audit log (single trustworthy trail;
 *    container-supplied metadata is recorded but marked untrusted).
 *  - Google credentials NEVER leave the host.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { DATA_DIR } from './config.js';
import { readEnvFile } from './env.js';
import { log } from './log.js';

const env = readEnvFile(['GWS_PROXY_TOKEN', 'GWS_PROXY_PORT', 'GWS_BINARY_PATH']);
const TOKEN = process.env.GWS_PROXY_TOKEN || env.GWS_PROXY_TOKEN || '';
const PORT = parseInt(process.env.GWS_PROXY_PORT || env.GWS_PROXY_PORT || '7850', 10);
const BIND = '172.17.0.1'; // Docker bridge gateway — container-only reachability
const GWS_BIN = process.env.GWS_BINARY_PATH || env.GWS_BINARY_PATH || 'gws';
const AUDIT_LOG = path.join(DATA_DIR, 'gws-audit.jsonl');

// gws top-level services the agent may invoke. Anything else is rejected.
const ALLOWED_SERVICES = new Set([
  'gmail',
  'sheets',
  'drive',
  'calendar',
  'docs',
  'slides',
  'chat',
  'forms',
  'discover',
  'help',
  '--help',
  '--version',
]);

// Verbs/sub-tokens that indicate a write (for audit classification + the
// container-side confirmation flow already gates these; this is defense-in-depth).
const WRITE_HINTS = [
  'send',
  'reply',
  'forward',
  'create',
  'update',
  'delete',
  'trash',
  'clear',
  'append',
  'insert',
  'batchUpdate',
  'move',
  'copy',
  '+send',
  '+reply',
  '+forward',
];

// Flags that could repoint auth/config/credentials — never allowed from a container.
const FORBIDDEN_FLAG_PREFIXES = ['--token', '--config', '--credentials', '--auth', '--account'];

// HARD-DENY destructive Drive/Docs file operations. No scheduled task or agent
// workflow needs to delete or trash Drive FILES (sheet edits use the `sheets`
// service: values clear/update; email cleanup uses `gmail ... trash`). Two Google
// Sheets were silently lost (concert 2026-05, quote-log 2026-05) — root cause never
// proven, but the agent's OAuth carries full `auth/drive` scope (delete capability)
// and scheduled tasks auto-confirm writes. This makes accidental/agentic Drive
// file deletion physically impossible through the proxy, regardless of token scope.
// Matched as `<service> <resource> <verb>` (e.g. `drive files delete`,
// `drive files update` with trashed=true). gmail trash is unaffected (different svc).
function isDeniedDriveOp(args: string[]): boolean {
  if (args[0] !== 'drive') return false;
  const joined = args.join(' ').toLowerCase();
  if (/\bfiles?\b.*\b(delete|trash|emptytrash|empty-trash)\b/.test(joined)) return true;
  // `drive files update ... trashed: true` (the trash-via-update path)
  if (/\bfiles?\b.*\bupdate\b/.test(joined) && /trashed["'\s:=]+true/.test(joined)) return true;
  return false;
}

function sanitizeArgs(args: string[]): { ok: true } | { ok: false; reason: string } {
  if (args.length === 0) return { ok: false, reason: 'empty args' };
  if (!ALLOWED_SERVICES.has(args[0])) return { ok: false, reason: `service not allowed: ${args[0]}` };
  if (isDeniedDriveOp(args))
    return { ok: false, reason: 'destructive Drive file op denied (delete/trash blocked by policy)' };
  for (const a of args) {
    const lower = a.toLowerCase();
    if (FORBIDDEN_FLAG_PREFIXES.some((p) => lower === p || lower.startsWith(p + '='))) {
      return { ok: false, reason: `forbidden flag: ${a}` };
    }
  }
  return { ok: true };
}

function classify(args: string[]): 'read' | 'write' {
  return args.some((a) => WRITE_HINTS.includes(a)) ? 'write' : 'read';
}

interface GwsResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

// Serialize gws invocations — token refresh mutates ~/.config/gws; concurrent
// runs can corrupt the token cache.
let pending: Promise<unknown> = Promise.resolve();
function runGwsSerialized(args: string[]): Promise<GwsResult> {
  const next = pending.then(() => runGws(args));
  pending = next.catch(() => undefined);
  return next;
}

// Pin gws to the credentials.json file (client_id/secret/refresh_token) rather
// than the keyring, so a re-consent that rewrites credentials.json (e.g. the
// post-incident downscope) immediately changes the proxy's effective scopes —
// no keyring re-sync. Falls back to gws's own auth if the file is unset/missing.
const GWS_CREDS_FILE =
  process.env.GWS_CREDENTIALS_FILE || path.join(os.homedir(), '.config', 'gws', 'credentials.json');

function runGws(args: string[]): Promise<GwsResult> {
  const start = Date.now();
  const childEnv = { ...process.env };
  if (fs.existsSync(GWS_CREDS_FILE)) childEnv.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE = GWS_CREDS_FILE;
  return new Promise((resolve) => {
    execFile(GWS_BIN, args, { timeout: 60_000, maxBuffer: 8 * 1024 * 1024, env: childEnv }, (err, stdout, stderr) => {
      const e = err as (Error & { code?: number }) | null;
      resolve({
        stdout: stdout?.toString() ?? '',
        stderr: stderr?.toString() ?? '',
        exitCode: e ? (typeof e.code === 'number' ? e.code : 1) : 0,
        durationMs: Date.now() - start,
      });
    });
  });
}

function audit(entry: Record<string, unknown>): void {
  try {
    fs.appendFileSync(AUDIT_LOG, JSON.stringify(entry) + '\n');
  } catch (err) {
    log.warn('gws-proxy: audit write failed', { err });
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(json);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

let server: ReturnType<typeof createServer> | null = null;

/**
 * Start the GWS proxy. No-op (with a log) if GWS_PROXY_TOKEN isn't configured —
 * GWS is opt-in. Bound to the Docker bridge so only local containers can reach it.
 */
export function startGwsProxy(): void {
  if (!TOKEN || TOKEN.length < 32) {
    log.info('GWS proxy disabled (GWS_PROXY_TOKEN unset or <32 chars)');
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });

  server = createServer((req, res) => {
    void (async () => {
      try {
        if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });
        if (req.method !== 'POST' || req.url !== '/gws') return send(res, 404, { error: 'not found' });

        const auth = req.headers['authorization'];
        if (auth !== `Bearer ${TOKEN}`) {
          audit({ ts: new Date().toISOString(), event: 'auth_reject', ip: req.socket.remoteAddress });
          return send(res, 401, { error: 'unauthorized' });
        }

        let parsed: { args?: unknown; meta?: unknown };
        try {
          parsed = JSON.parse(await readBody(req));
        } catch {
          return send(res, 400, { error: 'invalid json' });
        }
        const args = parsed.args;
        if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) {
          return send(res, 400, { error: 'args must be string[]' });
        }
        const argv = args as string[];

        const check = sanitizeArgs(argv);
        if (!check.ok) {
          audit({ ts: new Date().toISOString(), event: 'reject', reason: check.reason, args: argv });
          return send(res, 403, { error: check.reason });
        }

        const kind = classify(argv);
        const result = await runGwsSerialized(argv);
        audit({
          ts: new Date().toISOString(),
          event: 'exec',
          kind,
          args: argv,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          ip: req.socket.remoteAddress,
          meta_untrusted: parsed.meta ?? null, // container-supplied; not host-verified
        });
        return send(res, 200, { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode });
      } catch (err) {
        log.error('gws-proxy: handler error', { err });
        try {
          send(res, 500, { error: 'internal error' });
        } catch {
          /* response already sent */
        }
      }
    })();
  });

  server.listen(PORT, BIND, () => {
    log.info('GWS proxy listening', { bind: BIND, port: PORT, gwsBin: GWS_BIN, audit: AUDIT_LOG });
  });
  server.on('error', (err) => log.error('GWS proxy server error', { err }));
}

export function stopGwsProxy(): void {
  server?.close();
  server = null;
}
