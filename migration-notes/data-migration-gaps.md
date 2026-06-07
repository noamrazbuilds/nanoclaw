# Phase 1 — Data migration gaps audit (2026-06-03)

Read-only audit of `setup/migrate-v2/*.ts` (the v1→v2 migration pipeline shipped by upstream v2) against the fork's v1 schema in `/home/nanoclaw/NanoClaw/src/db.ts`. Identifies silent data losses that would occur if `bash migrate-v2.sh` ran today against the fork's production DB.

## v1 fork schema inventory

Source: `/home/nanoclaw/NanoClaw/src/db.ts` (1063 lines).

### Base tables (CREATE TABLE)

| # | Table | Lines | Fork-only? | Notes |
|---|---|---|---|---|
| 1 | `chats` | 28-34 | no | DM/group metadata; v1 |
| 2 | `messages` | 35-46 | no | Conversation history; v1 |
| 3 | `scheduled_tasks` | 49-61 | no | Scheduled task primary storage; v1 |
| 4 | `task_run_logs` | 65-74 | no | Task execution audit; v1 |
| 5 | `router_state` | 77-80 | no | Router KV store; v1 |
| 6 | `sessions` | 81-84 | no | Group→session-id map; v1 |
| 7 | `registered_groups` | 85-93 | no | Group registration; v1 |
| 8 | `reactions` | 95-103 | **fork-add** | WhatsApp emoji reactions storage (~27 rows / 15 days / 8 groups in production). F6 spec covers re-importing the table schema via cherry-pick `a23e372`; no data migration plan currently |
| 9 | `task_audit_log` | 192-200 | **fork-only** | Immutable record of task mutations (C5 spec) |
| 10 | `arena_sessions` | 208-218 | **fork-only** | Model Arena root sessions (F1 spec) |
| 11 | `arena_logs` | 222-244 | **fork-only** | Per-bot per-turn arena state |
| 12 | `arena_grades` | 252-269 | **fork-only** | Cross-bot grading results |

### ALTER TABLE column additions (fork-added over time)

| Column | Table | Line | Default | C-row that addresses it |
|---|---|---|---|---|
| `context_mode` | scheduled_tasks | 113 | `'isolated'` | tasks.ts already preserves via `migrated_from_v1.context_mode` |
| `script` | scheduled_tasks | 121 | NULL | tasks.ts already preserves via `migrated_from_v1.script` (actually just `script` field) |
| `model` | scheduled_tasks | 128 | NULL | **C4 part 1** — silently dropped today |
| `suppress_chat_output` | scheduled_tasks | 136 | 0 | **C4 part 1** — silently dropped today |
| `is_bot_message` | messages | 145 | 0 | Not migrated (messages table not migrated overall) |
| `channel` | chats | 157 | NULL | Not migrated (chats table not migrated overall) |
| `is_group` | chats | 158 | 0 | Not migrated (chats table not migrated overall) |
| `created_at` | sessions | 178 | `''` | C3 spec context — not migrated |
| `skills_hash` | sessions | 184 | `''` | **C3 spec** — fork-only agent drift safeguard; not migrated |

## What `setup/migrate-v2/*.ts` currently covers

| Step | File | Migrates |
|---|---|---|
| db | `db.ts` | `registered_groups` → `agent_groups` + `messaging_groups` + `messaging_group_agents`. Reads only 6 columns; ignores any others (none added in fork). |
| tasks | `tasks.ts` | `scheduled_tasks` (active only) → `messages_in` rows with `kind='task'`. Reads `SELECT *` but the V1Task interface and content-JSON build at lines 29-40 + 155-159 only preserve: `id`, `prompt`, `script`, `context_mode`. **Silently drops `model` + `suppress_chat_output`.** Also drops `last_run`, `last_result` (probably OK — history). |
| sessions | `sessions.ts` | Per-folder session creation + `.claude/` directory copy + JSONL session ID propagation into `outbound.db.session_state`. **Does not touch sessions.skills_hash.** |
| groups | `groups.ts` | Group folder files (CLAUDE.md → CLAUDE.local.md, container_config sidecar, all other files). File-system level; no DB columns. |
| env | `env.ts` | v1 `.env` keys → v2 `.env`. Never overwrites. |
| channel-auth | `channel-auth.ts` | Per-channel auth files (Baileys, Matrix, etc.) per CHANNEL_AUTH_REGISTRY. |
| (UI) | `discord-resolver.ts`, `select-channels.ts`, `switchover-prompt.ts`, `shared.ts` | Helpers, not data migration steps. |

Grep across `setup/migrate-v2/*.ts` for the fork-only surface produces **zero hits**:

```
$ grep -nE "reactions|arena|task_audit|model.*TEXT|suppress_chat_output|skills_hash" setup/migrate-v2/*.ts
(no output)
```

## Gaps — what would be silently lost on a `bash migrate-v2.sh` run today

| ID | Gap | Risk | Recommended action | Linked spec |
|---|---|---|---|---|
| G1 | `scheduled_tasks.model` per-task model selection | Tasks revert to v2 global default; for the user's setup that means losing the per-task Sonnet/Haiku routing | Extend `tasks.ts` content-JSON build to include `model` | C4 part 1 |
| G2 | `scheduled_tasks.suppress_chat_output` daily-update gate | Daily-update tasks would leak intermediate subagent output to chat. Production-observed bug 2026-05-15. | Extend `tasks.ts` content-JSON build to include `suppress_chat_output` | C4 part 1 |
| G3 | `sessions.skills_hash` agent drift safeguard | Stale sessions don't invalidate when skills change; agent drift returns | New migration step; populate from v1 sessions if v2 schema has the column (C3 will add it) | C3 |
| G4 | `task_audit_log` rows (audit history) | Audit trail of past task mutations lost; can't reconstruct who-changed-what before cutover | Add migration step for `task_audit_log` once v2 has the table (C5 adds it) | C5 |
| G5 | `reactions` rows (**12,852** in production, snapshot 2026-06-03) | Substantial conversation-history loss. Past reactions become invisible to the agent; references like "I reacted with X" lose context. The ~27 figure cited in spec extraction was for a specific subset (inbound stickers / 15 days / 8 groups) — total table is ~470× larger. | Add migration step for `reactions` once v2 has the table (F6 adds it via cherry-pick) | F6 |
| G6 | `arena_*` tables (Model Arena data: 12 sessions / 62 logs / 41 grades in production) | All historical arena sessions, bot logs, grades lost. Critical for F1's continuity — without it, arena conversation history is severed | Add migration step for `arena_sessions` + `arena_logs` + `arena_grades` once v2 has the tables (F1 adds them) | F1 |
| G7 | `messages` table (entire v1 conversation history) | Chat history before cutover not in v2's SQLite. Likely OK *if* sessions.ts's `.claude/` copy + JSONL continuation handles this for the agent's purposes, but verification needed | Test: does the v2 agent see pre-cutover messages via the JSONL continuation? If not, port `messages` to a fork-only audit table | none — needs decision |
| G8 | `chats.channel` + `chats.is_group` (chat metadata) | Chat-level metadata lost; v2's `messaging_groups.is_group` covers part of this but `channel` is more granular | Likely covered by db.ts's `inferIsGroup(channelType, platformId)` for messaging_groups. Verify by spot-check | low priority |
| G9 | `task_run_logs` (task execution history) | Past task runs no longer queryable | OK to drop (it's history; new runs will populate v2's equivalents) | drop |
| G10 | `messages.is_bot_message` column | If `messages` is migrated (G7) this also needs migrating | depends on G7 | depends on G7 |
| G11 | `router_state` KV store | Router state lost across cutover; v2 router rebuilds state at startup so probably OK | OK to drop | drop |
| G12 | `sessions.created_at` (session age) | Used by C3 24h-rotation; if lost, sessions look infinitely-young at startup | Set to migration time as default, OR populate from .claude/ file mtimes | C3 |
| G13 | `registered_groups.container_config` JSON | Fork stores per-group container config inline in this column; v2 splits into `container_configs` table. Upstream's db.ts:67-69 SELECT doesn't read this column. | Needs explicit handling: parse v1 JSON, write to v2 `container_configs` rows | new step |

## Sequence with code-port specs (C/F rows)

Phase 1 data migration **CANNOT FULLY LAND BEFORE** the code-port specs that introduce the v2-side schema:

- G4 (task_audit_log data) depends on **C5** porting the v2 schema
- G5 (reactions data) depends on **F6** cherry-picking `a23e372` which creates the v2 `reactions` table
- G6 (arena data) depends on **F1** creating v2 arena tables
- G3 (skills_hash) depends on **C3** adding the column to v2 sessions
- G1, G2, G12 only need changes to `setup/migrate-v2/tasks.ts` — no v2 schema dependency

This argues for a **two-pass Phase 1**:

- **Pass A (immediate, no spec deps):** Fix `tasks.ts` to preserve `model`, `suppress_chat_output`; fix `sessions.ts` (or sessions migration step) to set `created_at` and `skills_hash` from sources. Handle G13 (container_config JSON unpacking) since it's pure migration logic.
- **Pass B (after C3/C5/F1/F6 land their schema in v2):** Add migration steps for `reactions`, `task_audit_log`, `arena_*`, `skills_hash`. Each is a small focused script under `setup/migrate-v2/fork-extras-*.ts` or extended into the existing steps.

> **✅ PASS-B RESOLVED (2026-06-07) — all four consciously NOT migrated.** Once C3/C5/F1/F6 actually landed, their architectures overturned the migrate-everything assumption above:
> - **`reactions` (13,789) — SKIP** (user decision 2026-06-07). F6 put reactions in **per-session `inbound.db`**, keyed by platform message-id, as metadata that *never wakes the agent*; **no container read-path consumes them** (the reaction-consumption affordance is still an open F6 item). Sessions are created lazily, so there is no `inbound.db` to receive historical reactions at migration time. Migration is impractical *and* currently valueless; live reactions populate per-session going forward. The G5 "substantial loss" framing predates this design.
> - **`arena_*` (12/62/41) — FRESH START** (user decision 2026-06-07). F1's spec already deemed fresh acceptable; the user chose it over a continuity copy. Past arena rows remain in the v1 snapshot only.
> - **`task_audit_log` (49) — SKIP.** `tasks.ts` remaps v1 task-ids → new v2 ids (`migrated_from_v1.original_id`), so verbatim audit rows would carry dangling `task_id` refs. Its purpose (C5/C6) is forward integrity, not historical reconstruction. Low value + referential mismatch.
> - **`skills_hash` — MOOT.** Recomputed by C3's drift gate on first session resolution; nothing to migrate.
>
> **Net: Pass-B has zero new migration steps.** The migration pipeline is exactly Pass-A's steps (env, db, groups, sessions, tasks, container-configs, channel-auth). The frozen v1 snapshot (`~/nanoclaw-v1-snapshot-20260607-142631`, sha256 `031c7b48…`) retains everything not migrated, so nothing is destroyed.

## Recommended Phase 1 deliverables

1. **`setup/migrate-v2/tasks.ts` patch** — extend V1Task interface + content-JSON to include `model` and `suppress_chat_output`. ~10 LOC. Tested via dry-run against a copy of production messages.db.
2. **`setup/migrate-v2/sessions.ts` patch** — set `sessions.created_at` from `.claude/` mtime; set `skills_hash` if v2 schema has it (else leave for Pass B). ~15 LOC.
3. **`setup/migrate-v2/container-configs.ts`** new step — parse `registered_groups.container_config` JSON, write to v2 `container_configs` rows per agent_group. Handles G13. ~50 LOC.
4. **Test harness:** `scripts/test-data-migration.sh` — restore a backup of production `messages.db` into a tmp dir, run the full migrate-v2 pipeline, assert row counts (active scheduled_tasks → tasks-in-inbound matches; container_configs rows == registered_groups rows; etc.).
5. **Backup script** (read-only against production): `scripts/snapshot-prod-db.sh` — copies `~/NanoClaw/store/messages.db*` to `~/nanoclaw-v1-snapshot-<date>/` with a timestamp + sha256 manifest. Run before any migration testing. Production tree never modified.
6. **Idempotency tests** — extend the test harness to run the migration twice in succession against the same input; assert second run is a no-op (no new rows, no errors).
7. **Pass B deliverables** queued: 4 new migration steps for `reactions`, `task_audit_log`, `arena_*`, `skills_hash` — each sized at ~30-50 LOC, scheduled after the respective code-port spec lands.

## Open questions

1. **G7 (messages table):** does v2 agent see pre-cutover conversation via `.claude/` JSONL continuation? Test: after sessions.ts migration, can the agent recall a message from 2026-05-01? If yes: drop the SQL messages table. If no: need explicit port (and need to decide if it goes in the central DB or a per-session DB). **Status: open — answerable only after Pass A's test harness can run a migration end-to-end.**

2. ~~**`registered_groups.container_config` shape:**~~ **RESOLVED 2026-06-03.** Production has 2 rows, both with byte-identical shape:
   ```json
   {
     "additionalMounts": [{"hostPath": "/home/nanoclaw/pka", "containerPath": "pka", "readonly": false}],
     "allowModelDelegation": true,
     "model": "sonnet"
   }
   ```
   Maps to v2 `container_configs` columns (per `src/db/migrations/014-container-configs.ts`):
   - `additionalMounts` → `additional_mounts` (rename + JSON re-serialize; v2 stores as TEXT)
   - `model` → `model` (direct copy)
   - `allowModelDelegation` → **no v2 equivalent** — see Q5 below

3. **Backup retention:** **DECIDED: one pre-migration snapshot.** Production v1 install at `~/NanoClaw` is the canonical source until cutover. A second snapshot taken immediately before cutover. After cutover the post-cutover snapshot becomes the rollback artifact. No multi-snapshot cycle needed.

4. ~~**Production DB lock contention:**~~ **RESOLVED 2026-06-03.** Verified: `systemctl --user is-active nanoclaw` → `active`. WAL file mtime 2026-06-03 15:08 (within minutes of check) confirms the service is actively writing. **Naive `cp messages.db` is unsafe** — risks corruption of the snapshot due to in-flight WAL writes. The backup script (Pass A deliverable #5) must use `sqlite3 source.db ".backup target.db"` which is WAL-aware and safe with concurrent writers. Service stays running; no downtime for snapshot.

5. **`registered_groups.container_config.allowModelDelegation`** — `true` in both production rows, no obvious v2 equivalent in `container_configs` schema (the v2 columns are `provider, model, effort, image_tag, assistant_name, max_messages_per_prompt, skills, mcp_servers, packages_apt, packages_npm, additional_mounts`). Looks like a fork-only feature flag — probably related to scheduler delegating model choice to per-task `scheduled_tasks.model`. **Decision needed:** (a) port to a new fork-only column on v2 `container_configs` (would need a migration); (b) drop the field, lose the feature; (c) move the concept into a different surface (e.g. agent_groups table). Recommend (a) — preserves the behavior with minimal change. Sized at ~15 LOC migration + ~5 LOC update to `container-configs.ts` Pass A step.

## Effort estimate vs plan's 4-6h

The plan budgeted 4-6h. Re-estimate:

- Audit (this doc): ~1.5h ✅ (done)
- Pass A deliverables (tasks.ts patch, sessions.ts patch, container-configs.ts, backup script, test harness, idempotency tests): ~3-4h
- Pass B deliverables: ~3-4h spread across Phase 2 (each fires when its parent C/F spec lands its v2 schema)

Pass A alone fits in the plan's 4-6h budget. Pass B is "embedded" in Phase 2 (each migration sub-step lands alongside its parent code-port) — not additional Phase 1 time.

## Phase 1 dependencies on Phase 2

None of Pass A's deliverables block on Phase 2. Phase 1 Pass A is independent and can complete fully before any Phase 2 row starts.

Pass B is interleaved: each Pass B step lands after its parent Phase 2 row's v2 schema is in place. Concretely:

- F6 cherry-pick → Pass B step for `reactions` data migration → F6 done
- C5 schema port → Pass B step for `task_audit_log` data → C5 done
- F1 schema port → Pass B step for `arena_*` data → F1 done
- C3 schema column → Pass B step for `skills_hash` data → C3 done

The "row is complete" gate in Phase 2 includes its associated Pass B data-migration step.
