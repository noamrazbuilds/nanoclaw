#!/usr/bin/env tsx
/**
 * build-message-archive.ts — import v1 message history into a searchable v2 archive.
 *
 * v2 has no global message store (the router only persists messages it engages
 * with or accumulates). To let the agent search past cross-chat conversations,
 * this copies the v1 `chats` + `messages` tables from the frozen snapshot into a
 * dedicated `data/archive.db` and builds an FTS5 full-text index over message
 * content. The archive is read-only history — the live `accumulate` policy
 * grows forward coverage separately.
 *
 * Idempotent: rebuilds the archive from scratch each run (DROP + recreate).
 *
 * Usage: tsx scripts/build-message-archive.ts [--src <v1-messages.db>] [--out <archive.db>]
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const DEFAULT_SNAP = path.join(os.homedir(), 'nanoclaw-v1-snapshot-20260607-142631', 'store', 'messages.db');
const src = arg('--src', DEFAULT_SNAP);
const out = arg('--out', path.join(process.cwd(), 'data', 'archive.db'));

if (!fs.existsSync(src)) {
  console.error(`source not found: ${src}`);
  process.exit(1);
}

const db = new Database(out);
db.pragma('journal_mode = WAL');

// Fresh build — drop any prior archive content.
db.exec(`
  DROP TABLE IF EXISTS messages_fts;
  DROP TABLE IF EXISTS messages;
  DROP TABLE IF EXISTS chats;

  CREATE TABLE chats (
    jid               TEXT PRIMARY KEY,
    name              TEXT,
    last_message_time TEXT,
    channel           TEXT,
    is_group          INTEGER DEFAULT 0
  );

  CREATE TABLE messages (
    id             TEXT,
    chat_jid       TEXT,
    sender         TEXT,
    sender_name    TEXT,
    content        TEXT,
    timestamp      TEXT,
    is_from_me     INTEGER,
    is_bot_message INTEGER DEFAULT 0,
    PRIMARY KEY (id, chat_jid)
  );
  CREATE INDEX idx_archive_msg_chat ON messages(chat_jid);
  CREATE INDEX idx_archive_msg_time ON messages(timestamp);

  -- FTS5 over message content, with chat_jid + timestamp as unindexed
  -- columns so a single query returns where/when without a join.
  CREATE VIRTUAL TABLE messages_fts USING fts5(
    content,
    chat_jid UNINDEXED,
    sender_name UNINDEXED,
    timestamp UNINDEXED,
    tokenize = 'unicode61'
  );
`);

const srcDb = new Database(src, { readonly: true });
const chats = srcDb.prepare('SELECT jid, name, last_message_time, channel, is_group FROM chats').all() as Array<
  Record<string, unknown>
>;
const messages = srcDb.prepare(
  'SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message FROM messages',
).all() as Array<Record<string, unknown>>;
srcDb.close();

const insChat = db.prepare(
  'INSERT OR REPLACE INTO chats (jid, name, last_message_time, channel, is_group) VALUES (@jid, @name, @last_message_time, @channel, @is_group)',
);
const insMsg = db.prepare(
  `INSERT OR IGNORE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message)
   VALUES (@id, @chat_jid, @sender, @sender_name, @content, @timestamp, @is_from_me, @is_bot_message)`,
);
const insFts = db.prepare(
  'INSERT INTO messages_fts (content, chat_jid, sender_name, timestamp) VALUES (@content, @chat_jid, @sender_name, @timestamp)',
);

const importAll = db.transaction(() => {
  for (const c of chats) insChat.run(c);
  for (const m of messages) {
    insMsg.run(m);
    if (typeof m.content === 'string' && m.content.length > 0) {
      insFts.run({ content: m.content, chat_jid: m.chat_jid, sender_name: m.sender_name, timestamp: m.timestamp });
    }
  }
});
importAll();

const chatCount = (db.prepare('SELECT count(*) c FROM chats').get() as { c: number }).c;
const msgCount = (db.prepare('SELECT count(*) c FROM messages').get() as { c: number }).c;
const ftsCount = (db.prepare('SELECT count(*) c FROM messages_fts').get() as { c: number }).c;
db.close();

console.log(`OK: archive=${out} chats=${chatCount} messages=${msgCount} fts_indexed=${ftsCount}`);
