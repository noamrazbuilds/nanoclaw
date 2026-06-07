import type Database from 'better-sqlite3';
import type { Migration } from './index.js';

/**
 * F3: per-group Python pip dependencies, mirroring packages_apt / packages_npm.
 * Container skills written in Python (e.g. link-to-audio) declare their pip deps
 * here; the per-group image build installs them. JSON array of pip requirement
 * strings, e.g. ["openai","newspaper3k"]. Empty by default.
 */
export const migration019: Migration = {
  version: 19,
  name: 'packages-pip',
  up(db: Database.Database) {
    db.exec(`
      ALTER TABLE container_configs
      ADD COLUMN packages_pip TEXT NOT NULL DEFAULT '[]';
    `);
  },
};
