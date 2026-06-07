/**
 * U6 — human-readable Markdown transcript archiving.
 *
 * v2 already persists conversations continuously (per-turn session DB + the SDK
 * .jsonl), so this is NOT about crash-safety — it's the human-readable Markdown
 * archive under /workspace/agent/conversations/ that the user (and the agent in
 * future sessions) skims. Two callers:
 *   - the SDK PreCompact hook (providers/claude.ts) — descriptive name; and
 *   - the SIGTERM handler (index.ts) — the "Docker killed us" case PreCompact
 *     never sees, archived as an incomplete-session.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const CONVERSATIONS_DIR = '/workspace/agent/conversations';

export interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function parseTranscript(content: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'user' && entry.message?.content) {
        const text =
          typeof entry.message.content === 'string'
            ? entry.message.content
            : entry.message.content.map((c: { text?: string }) => c.text || '').join('');
        if (text) messages.push({ role: 'user', content: text });
      } else if (entry.type === 'assistant' && entry.message?.content) {
        const textParts = entry.message.content
          .filter((c: { type: string }) => c.type === 'text')
          .map((c: { text: string }) => c.text);
        const text = textParts.join('');
        if (text) messages.push({ role: 'assistant', content: text });
      }
    } catch {
      /* skip unparseable lines */
    }
  }
  return messages;
}

export function formatTranscriptMarkdown(messages: ParsedMessage[], title?: string | null, assistantName?: string): string {
  const now = new Date();
  const dateStr = now.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const lines = [`# ${title || 'Conversation'}`, '', `Archived: ${dateStr}`, '', '---', ''];
  for (const msg of messages) {
    const sender = msg.role === 'user' ? 'User' : assistantName || 'Assistant';
    const content = msg.content.length > 2000 ? msg.content.slice(0, 2000) + '...' : msg.content;
    lines.push(`**${sender}**: ${content}`, '');
  }
  return lines.join('\n');
}

/**
 * Archive a .jsonl transcript as Markdown. Returns the written filename, or null
 * if nothing was archived (missing/empty transcript). `incomplete` names the
 * file `incomplete-session` (SIGTERM/crash); otherwise a summary-derived or
 * time-based descriptive name (clean exit / PreCompact).
 */
export function archiveTranscript(
  transcriptPath: string | null,
  assistantName: string | undefined,
  opts: { incomplete?: boolean; summary?: string } = {},
): string | null {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
  let messages: ParsedMessage[];
  try {
    messages = parseTranscript(fs.readFileSync(transcriptPath, 'utf-8'));
  } catch {
    return null;
  }
  if (messages.length === 0) return null;

  const namePart = opts.incomplete
    ? 'incomplete-session'
    : opts.summary
      ? opts.summary
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 50)
      : `conversation-${new Date().getHours().toString().padStart(2, '0')}${new Date()
          .getMinutes()
          .toString()
          .padStart(2, '0')}`;

  fs.mkdirSync(CONVERSATIONS_DIR, { recursive: true });
  const filename = `${new Date().toISOString().split('T')[0]}-${namePart}.md`;
  const title = opts.summary ?? (opts.incomplete ? 'Incomplete session' : undefined);
  fs.writeFileSync(path.join(CONVERSATIONS_DIR, filename), formatTranscriptMarkdown(messages, title, assistantName));
  return filename;
}

/**
 * True if a conversation .md was written within `withinMs` — the SIGTERM handler
 * skips archiving when PreCompact just did (avoids a duplicate incomplete file).
 */
export function recentlyArchived(withinMs = 5 * 60_000): boolean {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(CONVERSATIONS_DIR)) {
      if (!f.endsWith('.md')) continue;
      if (now - fs.statSync(path.join(CONVERSATIONS_DIR, f)).mtimeMs < withinMs) return true;
    }
  } catch {
    /* conversations dir doesn't exist yet */
  }
  return false;
}

/**
 * Find the most-recently-modified SDK transcript .jsonl. The SIGTERM handler has
 * no PreCompact input giving the exact path, so it locates the current run's
 * transcript by recency under ~/.claude/projects/.
 */
export function findLatestTranscript(): string | null {
  const base = path.join(os.homedir(), '.claude', 'projects');
  let latestPath: string | null = null;
  let latestMtime = -1;
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) {
        try {
          const m = fs.statSync(p).mtimeMs;
          if (m > latestMtime) {
            latestMtime = m;
            latestPath = p;
          }
        } catch {
          /* race: file vanished */
        }
      }
    }
  };
  walk(base);
  return latestPath;
}
