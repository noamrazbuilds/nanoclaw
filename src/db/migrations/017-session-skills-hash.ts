import type Database from 'better-sqlite3';
import type { Migration } from './index.js';

/**
 * C3 (agent-drift safeguard): record the container-skill set fingerprint on
 * each session at creation, so a later skill edit invalidates the session
 * (forcing a fresh one) instead of silently mixing old + new instructions.
 *
 * Existing rows get '' — a sentinel that never matches a real hash, so any
 * pre-migration session is treated as skill-stale and rotated on its next
 * wake (also harmless: the 24h age cap rotates them anyway). See
 * src/skills-hash.ts and resolveSession() in src/session-manager.ts.
 */
export const migration017: Migration = {
  version: 17,
  name: 'session-skills-hash',
  up(db: Database.Database) {
    db.exec(`
      ALTER TABLE sessions
      ADD COLUMN skills_hash TEXT NOT NULL DEFAULT '';
    `);
  },
};
