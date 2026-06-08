/**
 * Central message archive (host-side).
 *
 * v2 has no global message store — the router scatters messages into per-session
 * inbound.dbs. Scheduled tasks (morning triage, daily update) need "recent
 * messages across all chats" + keyword search. This mirrors EVERY inbound
 * message the host sees (in a known messaging group) into a single
 * `data/archive.db` — the same file that holds the imported v1 history and is
 * mounted read-only into owner agent-group containers at /workspace/extra/archive.db.
 *
 * Design (gauntlet-validated 2026-06-08, gauntlet-logs/gauntlet-2026-06-08-073159.md):
 *   - Host is the SOLE writer (preserves one-writer-per-file).
 *   - journal_mode=DELETE → safe live reads across the container bind mount
 *     (fcntl byte-range locks work across bind mounts; WAL's mmap'd -shm does not).
 *   - The agent reads the RO-mounted file directly; "unread/recent" is a
 *     timestamp watermark the triage keeps in its own workspace (no write-back).
 *
 * Schema matches scripts/build-message-archive.ts so historical + live coexist.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { log } from './log.js';

let db: Database.Database | null = null;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS chats (
    jid TEXT PRIMARY KEY, name TEXT, last_message_time TEXT, channel TEXT, is_group INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT, chat_jid TEXT, sender TEXT, sender_name TEXT, content TEXT, timestamp TEXT,
    is_from_me INTEGER, is_bot_message INTEGER DEFAULT 0, PRIMARY KEY (id, chat_jid)
  );
  CREATE INDEX IF NOT EXISTS idx_archive_msg_chat ON messages(chat_jid);
  CREATE INDEX IF NOT EXISTS idx_archive_msg_time ON messages(timestamp);
  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content, chat_jid UNINDEXED, sender_name UNINDEXED, timestamp UNINDEXED, tokenize = 'unicode61'
  );
`;

function getDb(): Database.Database {
  if (db) return db;
  const dbPath = path.join(DATA_DIR, 'archive.db');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = DELETE'); // cross-mount visibility for RO container readers
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  return db;
}

export interface ArchiveMessageInput {
  channelType: string;
  platformId: string;
  chatName: string | null;
  isGroup: boolean;
  messageId: string;
  sender: string | null;
  senderName: string | null;
  text: string;
  timestamp: string; // ISO
  fromMe: boolean;
  isBotMessage: boolean;
}

/**
 * Mirror one inbound message into the central archive. Best-effort: never throws
 * into the router — archiving is observability, not correctness. INSERT OR IGNORE
 * keeps it idempotent on (id, chat_jid) so redelivery/replay doesn't duplicate.
 */
export function archiveInboundMessage(m: ArchiveMessageInput): void {
  if (!m.text && !m.messageId) return;
  try {
    const d = getDb();
    d.prepare(
      `INSERT INTO chats (jid, name, last_message_time, channel, is_group)
       VALUES (@jid, @name, @ts, @channel, @is_group)
       ON CONFLICT(jid) DO UPDATE SET
         name = COALESCE(excluded.name, chats.name),
         last_message_time = excluded.last_message_time`,
    ).run({
      jid: m.platformId,
      name: m.chatName,
      ts: m.timestamp,
      channel: m.channelType,
      is_group: m.isGroup ? 1 : 0,
    });

    const res = d
      .prepare(
        `INSERT OR IGNORE INTO messages
           (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message)
         VALUES (@id, @chat, @sender, @sender_name, @content, @ts, @from_me, @bot)`,
      )
      .run({
        id: m.messageId,
        chat: m.platformId,
        sender: m.sender,
        sender_name: m.senderName,
        content: m.text,
        ts: m.timestamp,
        from_me: m.fromMe ? 1 : 0,
        bot: m.isBotMessage ? 1 : 0,
      });

    // Only index newly-inserted rows in FTS (changes>0 means not a dup).
    if (res.changes > 0 && m.text) {
      d.prepare(
        `INSERT INTO messages_fts (content, chat_jid, sender_name, timestamp)
         VALUES (@content, @chat, @sender_name, @ts)`,
      ).run({ content: m.text, chat: m.platformId, sender_name: m.senderName, ts: m.timestamp });
    }
  } catch (err) {
    log.warn('archiveInboundMessage failed', { err, platformId: m.platformId });
  }
}

/** Close the archive DB (graceful shutdown). */
export function closeMessageArchive(): void {
  try {
    db?.close();
  } catch {
    /* ignore */
  }
  db = null;
}
