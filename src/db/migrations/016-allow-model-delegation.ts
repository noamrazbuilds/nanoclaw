import type Database from 'better-sqlite3';
import type { Migration } from './index.js';

/**
 * Fork-only column: `allow_model_delegation` on `container_configs`.
 *
 * Preserves a v1-fork feature flag carried in
 * registered_groups.container_config JSON (alongside `model` + `additionalMounts`).
 * In the v1 fork, the flag let the scheduler choose per-task models via
 * scheduled_tasks.model overrides. v2 has no equivalent today; this
 * migration adds the column so the v1→v2 migration (in
 * setup/migrate-v2/container-configs.ts) can preserve the value, and
 * C4 part 2's scheduling-executor port can honor it at runtime.
 *
 * See migration-notes/data-migration-gaps.md Q5 for the audit context.
 */
export const migration016: Migration = {
  version: 16,
  name: 'allow-model-delegation',
  up(db: Database.Database) {
    db.exec(`
      ALTER TABLE container_configs
      ADD COLUMN allow_model_delegation INTEGER NOT NULL DEFAULT 0;
    `);
  },
};
