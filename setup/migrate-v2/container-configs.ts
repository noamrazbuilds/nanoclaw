/**
 * migrate-v2 step: container-configs
 *
 * Port v1 fork's per-group container config from
 *   registered_groups.container_config (JSON blob)
 * into v2's structured
 *   container_configs (per-agent-group row)
 * table.
 *
 * v1 JSON shape (observed in production 2026-06-03):
 *   {
 *     "additionalMounts": [{"hostPath": "...", "containerPath": "...", "readonly": bool}],
 *     "allowModelDelegation": bool,
 *     "model": "sonnet"
 *   }
 *
 * Mapping to v2 container_configs columns:
 *   additionalMounts        → additional_mounts (JSON re-serialized)
 *   model                   → model
 *   allowModelDelegation    → allow_model_delegation (0|1, added by migration 016)
 *   (other columns default — provider null, effort null, etc.)
 *
 * Requires: db step must have run first (agent_groups seeded from
 * registered_groups). Migration 016 must have been applied.
 *
 * Idempotent: skips agent_groups that already have a container_configs row.
 *
 * Usage: pnpm exec tsx setup/migrate-v2/container-configs.ts <v1-path>
 */
import fs from 'fs';
import path from 'path';

import Database from 'better-sqlite3';

import { DATA_DIR } from '../../src/config.js';
import { initDb, closeDb } from '../../src/db/connection.js';
import { getAgentGroupByFolder } from '../../src/db/agent-groups.js';
import { runMigrations } from '../../src/db/migrations/index.js';

interface V1RegisteredGroupConfig {
  folder: string;
  container_config: string | null;
}

interface V1ContainerConfigBlob {
  additionalMounts?: Array<{ hostPath: string; containerPath: string; readonly?: boolean }>;
  allowModelDelegation?: boolean;
  model?: string;
}

function parseV1Config(json: string, label: string): V1ContainerConfigBlob | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as V1ContainerConfigBlob;
  } catch (err) {
    console.error(
      `WARN:invalid container_config JSON for ${label}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

function main(): void {
  const v1Path = process.argv[2];
  if (!v1Path) {
    console.error('Usage: tsx setup/migrate-v2/container-configs.ts <v1-path>');
    process.exit(1);
  }

  const v1DbPath = path.join(v1Path, 'store', 'messages.db');
  if (!fs.existsSync(v1DbPath)) {
    console.log('SKIPPED:no v1 DB');
    process.exit(0);
  }

  const v1Db = new Database(v1DbPath, { readonly: true, fileMustExist: true });
  const v1Rows = v1Db
    .prepare(
      'SELECT folder, container_config FROM registered_groups WHERE container_config IS NOT NULL',
    )
    .all() as V1RegisteredGroupConfig[];
  v1Db.close();

  if (v1Rows.length === 0) {
    console.log('SKIPPED:no v1 container_config rows');
    process.exit(0);
  }

  const v2DbPath = path.join(DATA_DIR, 'v2.db');
  if (!fs.existsSync(v2DbPath)) {
    console.error('v2.db not found — run db step first');
    process.exit(1);
  }
  const v2Db = initDb(v2DbPath);
  runMigrations(v2Db);

  // Idempotency: check existing container_configs rows once.
  const existing = new Set<string>(
    (v2Db.prepare('SELECT agent_group_id FROM container_configs').all() as { agent_group_id: string }[]).map(
      (r) => r.agent_group_id,
    ),
  );

  // Prepared insert. Other columns left at their schema defaults.
  const insert = v2Db.prepare(`
    INSERT INTO container_configs (
      agent_group_id,
      model,
      additional_mounts,
      allow_model_delegation,
      updated_at
    ) VALUES (
      @agent_group_id,
      @model,
      @additional_mounts,
      @allow_model_delegation,
      @updated_at
    )
  `);

  let migrated = 0;
  let skippedNoAg = 0;
  let skippedExisting = 0;
  let skippedBadJson = 0;
  const now = new Date().toISOString();

  for (const row of v1Rows) {
    if (!row.container_config) { skippedBadJson++; continue; }

    const ag = getAgentGroupByFolder(row.folder);
    if (!ag) { skippedNoAg++; continue; }
    if (existing.has(ag.id)) { skippedExisting++; continue; }

    const parsed = parseV1Config(row.container_config, row.folder);
    if (!parsed) { skippedBadJson++; continue; }

    const additionalMounts = Array.isArray(parsed.additionalMounts)
      ? JSON.stringify(parsed.additionalMounts)
      : '[]';
    const model = typeof parsed.model === 'string' ? parsed.model : null;
    const allowDelegation = parsed.allowModelDelegation === true ? 1 : 0;

    insert.run({
      agent_group_id: ag.id,
      model,
      additional_mounts: additionalMounts,
      allow_model_delegation: allowDelegation,
      updated_at: now,
    });
    migrated++;
  }

  closeDb();
  console.log(
    `OK:rows=${v1Rows.length},migrated=${migrated},skipped_no_ag=${skippedNoAg},skipped_existing=${skippedExisting},skipped_bad_json=${skippedBadJson}`,
  );
}

main();
