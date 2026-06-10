/**
 * reMarkable MCP server (container side) — READ-ONLY page fetch via the host proxy.
 *
 * rmapi + its cloud token + its destructive verbs (rm/mv/put) stay on the HOST
 * (see the sheet-deletion incident). This forwards two read-only operations to
 * src/remarkable-proxy.ts over host.docker.internal; the cloud token never
 * enters the container. Rendered PNGs are written under /workspace/agent so the
 * agent can hand them to send_file.
 *
 * Tools:
 *   remarkable_list        — list reMarkable notebooks/folders (no trash)
 *   remarkable_get_page    — fetch + render a notebook page → saved PNG path(s)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

const PROXY_URL = process.env.REMARKABLE_PROXY_URL || 'http://host.docker.internal:7851';
const PROXY_TOKEN = process.env.REMARKABLE_PROXY_TOKEN || '';
const OUT_DIR = '/workspace/agent/remarkable';

async function proxy(pathname: string, body: unknown, timeoutMs: number): Promise<{ ok: boolean; data: unknown; error?: string }> {
  if (!PROXY_TOKEN) return { ok: false, data: null, error: 'REMARKABLE_PROXY_TOKEN not configured — reMarkable unavailable in this group.' };
  try {
    const resp = await fetch(`${PROXY_URL}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROXY_TOKEN}` },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) return { ok: false, data, error: `proxy ${resp.status}` };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, data: null, error: `proxy unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

const server = new McpServer({ name: 'remarkable', version: '1.0.0' });

server.tool(
  'remarkable_list',
  'List the notebooks and folders on the user\'s reMarkable tablet (excludes trash). Read-only. Use the returned `path` values with remarkable_get_page.',
  {},
  async () => {
    const r = await proxy('/list', {}, 60_000);
    if (!r.ok) return { content: [{ type: 'text' as const, text: `reMarkable list failed: ${r.error}` }], isError: true };
    const nbs = (r.data as { notebooks?: Array<{ path: string; type: string }> })?.notebooks ?? [];
    const lines = nbs.map((n) => `${n.type === 'dir' ? '📁' : '📄'} ${n.path}`).join('\n');
    return { content: [{ type: 'text' as const, text: lines || '(no notebooks found)' }] };
  },
);

server.tool(
  'remarkable_get_page',
  `Fetch a page from a reMarkable notebook and render it to a PNG image (read-only).
Returns the saved file path(s); deliver to the user with send_file.
- notebook: the notebook path from remarkable_list (e.g. "Quick notes" or "/00 Wiz/Customers/Amazon").
- page: 1-based page number. Omit to render ALL pages of the notebook (capped).`,
  {
    notebook: z.string().describe('Notebook path from remarkable_list'),
    page: z.number().int().positive().optional().describe('1-based page number; omit for all pages'),
  },
  async (args) => {
    const r = await proxy('/page', { notebook: args.notebook, page: args.page }, 240_000);
    if (!r.ok) {
      const detail = (r.data as { error?: string })?.error || r.error || 'unknown error';
      return { content: [{ type: 'text' as const, text: `reMarkable fetch failed: ${detail}` }], isError: true };
    }
    const d = r.data as { notebook: string; page_count: number; pages: Array<{ index: number; png_b64: string; blank: boolean }> };
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const safe = args.notebook.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'notebook';
    const saved: string[] = [];
    for (const p of d.pages) {
      const file = path.join(OUT_DIR, `${safe}-p${p.index}.png`);
      fs.writeFileSync(file, Buffer.from(p.png_b64, 'base64'));
      saved.push(`${file}${p.blank ? ' (appears blank)' : ''}`);
    }
    const summary =
      `Rendered ${d.pages.length} page(s) from "${d.notebook}" (notebook has ${d.page_count} page(s) total).\n` +
      `Saved:\n${saved.map((s) => '  ' + s).join('\n')}\n` +
      `Send these to the user with send_file (path = the .png path above).`;
    return { content: [{ type: 'text' as const, text: summary }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
