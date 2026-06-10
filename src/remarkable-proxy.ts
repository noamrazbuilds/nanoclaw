/**
 * reMarkable host-side proxy — READ-ONLY bridge (mirrors src/gws-proxy.ts).
 *
 * Why: rmapi (reMarkable cloud CLI) + the render stack (rmc + cairosvg) are
 * authenticated host-side. Putting rmapi's cloud token AND its destructive verbs
 * (rm/mv/put) in agent containers would re-create the credential-+-delete-
 * capability risk that caused the Google Sheet deletions. Instead the host runs
 * the read-only fetch/render (scripts/remarkable_fetch.py — find/get only) and
 * the container requests pages over host.docker.internal.
 *
 * Security posture (same as gws-proxy):
 *  - Binds to the Docker bridge gateway (172.17.0.1), NOT 0.0.0.0.
 *  - Bearer token (REMARKABLE_PROXY_TOKEN, ≥32 chars).
 *  - The ONLY operations exposed are list + fetch-page; the helper only ever
 *    calls rmapi find/get. No delete/move/upload path exists, by construction.
 *  - Serialized execution (rmapi download + render is heavy and stateful).
 *  - reMarkable cloud token never leaves the host.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

import { readEnvFile } from './env.js';
import { log } from './log.js';

const env = readEnvFile(['REMARKABLE_PROXY_TOKEN', 'REMARKABLE_PROXY_PORT']);
const TOKEN = process.env.REMARKABLE_PROXY_TOKEN || env.REMARKABLE_PROXY_TOKEN || '';
const PORT = parseInt(process.env.REMARKABLE_PROXY_PORT || env.REMARKABLE_PROXY_PORT || '7851', 10);
const BIND = '172.17.0.1';
const HELPER = path.join(process.cwd(), 'scripts', 'remarkable_fetch.py');

interface HelperResult {
  stdout: string;
  exitCode: number;
}

// Serialize — rmapi mutates ~/.config/rmapi token cache + render is CPU-heavy.
let pending: Promise<unknown> = Promise.resolve();
function runHelperSerialized(args: string[]): Promise<HelperResult> {
  const next = pending.then(() => runHelper(args));
  pending = next.catch(() => undefined);
  return next;
}

function runHelper(args: string[]): Promise<HelperResult> {
  return new Promise((resolve) => {
    execFile('python3', [HELPER, ...args], { timeout: 240_000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      const e = err as (Error & { code?: number }) | null;
      resolve({ stdout: stdout?.toString() ?? '', exitCode: e ? (typeof e.code === 'number' ? e.code : 1) : 0 });
    });
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

let server: ReturnType<typeof createServer> | null = null;

/** Start the reMarkable proxy. No-op (with a log) unless REMARKABLE_PROXY_TOKEN is set. */
export function startRemarkableProxy(): void {
  if (!TOKEN || TOKEN.length < 32) {
    log.info('reMarkable proxy disabled (REMARKABLE_PROXY_TOKEN unset or <32 chars)');
    return;
  }
  if (!fs.existsSync(HELPER)) {
    log.warn('reMarkable proxy: helper script missing, not starting', { helper: HELPER });
    return;
  }

  server = createServer((req, res) => {
    void (async () => {
      try {
        if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });
        if (req.method !== 'POST') return send(res, 404, { error: 'not found' });

        if (req.headers['authorization'] !== `Bearer ${TOKEN}`) {
          return send(res, 401, { error: 'unauthorized' });
        }

        // /list — enumerate notebooks (read-only)
        if (req.url === '/list') {
          const r = await runHelperSerialized(['--list']);
          return send(res, r.exitCode === 0 ? 200 : 502, safeParse(r.stdout));
        }

        // /page — fetch + render a notebook page (read-only)
        if (req.url === '/page') {
          let body: { notebook?: unknown; page?: unknown };
          try {
            body = JSON.parse(await readBody(req));
          } catch {
            return send(res, 400, { error: 'invalid json' });
          }
          if (typeof body.notebook !== 'string' || !body.notebook.trim()) {
            return send(res, 400, { error: 'notebook (string) required' });
          }
          const args = ['--notebook', body.notebook];
          if (typeof body.page === 'number' && Number.isInteger(body.page) && body.page > 0) {
            args.push('--page', String(body.page));
          }
          const r = await runHelperSerialized(args);
          return send(res, r.exitCode === 0 ? 200 : 502, safeParse(r.stdout));
        }

        return send(res, 404, { error: 'not found' });
      } catch (err) {
        log.error('remarkable-proxy: handler error', { err });
        try {
          send(res, 500, { error: 'internal error' });
        } catch {
          /* already sent */
        }
      }
    })();
  });

  server.listen(PORT, BIND, () => {
    log.info('reMarkable proxy listening', { bind: BIND, port: PORT, helper: HELPER });
  });
  server.on('error', (err) => log.error('reMarkable proxy server error', { err }));
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return { error: 'helper produced no/invalid JSON', raw: s.slice(0, 200) };
  }
}

export function stopRemarkableProxy(): void {
  server?.close();
  server = null;
}
