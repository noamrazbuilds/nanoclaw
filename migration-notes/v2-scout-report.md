# NanoClaw v1 → v2 Scout Report

Generated 2026-05-14 by Scout. All findings are read-only ground truth from `upstream/main@fa945a1` vs `origin/main` (~221 commits ahead of merge-base `4383e3e`/v1.2.35). Builder/Porter agents consume this; no porting strategy or code is proposed here.

---

## Executive Summary — 3 biggest Phase 1 risks

1. **`migrate-v2.sh` will hard-fail on this fork's v1 DB at step `1b-db`.** Upstream's `setup/migrate-v2/db.ts:68` runs `SELECT jid, name, folder, trigger_pattern, requires_trigger, is_main FROM registered_groups`, but the fork's CREATE TABLE at `src/db.ts:85-93` has no `is_main` column (the fork tracks main-ness implicitly by folder name `groups/main/`). The query throws `SQLITE_ERROR: no such column: is_main`, `1b-db` records `failed`, every later step that depends on `agent_groups` (sessions, tasks) is skipped → `handoff.overall_status='partial'` with effectively nothing migrated. This is a **blocker for the wholesale script path** unless the v1 DB is pre-patched with an `is_main` column or upstream's db.ts is patched to tolerate the missing column.

2. **No v2 equivalent for the credit-error fallback + BLOB prompt coercion hotfix (commit `8d42685`).** Upstream has no cross-provider fallback on Anthropic 529/credit-exhausted, no `isCreditError`, no LiteLLM wiring in core code, and no Buffer→String coercion in scheduling. v2 has a startup circuit breaker (`src/circuit-breaker.ts`) but it gates rapid restarts, not provider-level errors. The fork's Daily Update / PKA briefing / memory-consolidation tasks lose their resilience the moment v2 takes over — re-introducing this without a host-level provider-fallback layer is fork-only work.

3. **v2's IPC = two SQLite files; sticker / audio / document / native MCP-stdio bridge are gone.** Upstream's outbound vocabulary is `chat` + the four `operation` types `edit | reaction | ask_question | card`, plus optional `files`. There is no `sticker` op (recently-added fork feature `940c147` for outbound stickers becomes inbound-only by default), `send_audio` is not a first-class op (audio files ride as attachments), `send_document` is just an attachment, and `register_group` / `host_op` / `pause_task` / `resume_task` / `cancel_task` / `generate_image` / `react_to_message` tools that this fork's `container/agent-runner/src/ipc-mcp-stdio.ts` exposes have no v2 analogue. The v2 native MCP-stdio bridge is gone — agent-runner is Bun, uses `container/agent-runner/src/mcp-tools/core.ts` (`registerTools`), and the host reads `outbound.db.messages_out` via cross-mount SQLite (DELETE journal mode). Channel re-port can proceed in parallel, but the v1 fork's custom tool surface needs an explicit per-tool decision per Porter-Features/Porter-Utils.

---

## 1. Primer pass — which migration skill applies

Read in full: `docs/v1-to-v2-changes.md` (upstream/main), `.claude/skills/migrate-from-v1/SKILL.md`, `.claude/skills/migrate-nanoclaw/SKILL.md` (+ `diagnostics.md`), `.claude/skills/migrate-from-openclaw/SKILL.md`.

| Doc / Skill | Purpose | Audience | Applies to this fork? |
|---|---|---|---|
| `docs/v1-to-v2-changes.md` | Vocabulary doc — what moved/renamed v1→v2. Not a migration guide. | Anyone touching v2 internals or porting v1 work. | **Yes.** Required reading; supplies the entity model and DB shape that Builder/Porters need. |
| `.claude/skills/migrate-from-v1/SKILL.md` | Picks up *after* `bash migrate-v2.sh` runs. Owner seeding, access policy, `CLAUDE.local.md` cleanup, container config reconciliation, **fork porting (Phase 4)**. | A v1 user who already ran `migrate-v2.sh`. | **Yes — this is the canonical skill for fork users.** Phase 4 (`"How do you want to handle your v1 customizations?"`) explicitly covers customized installs and says source code (`src/*`, `container/agent-runner/src/*`) is **not portable** — stash to `docs/v1-fork-reference/`. Quote: `"Source code (`src/*`, `container/agent-runner/src/*`) is NOT portable — v2's architecture is fundamentally different. Stash to `docs/v1-fork-reference/` with a README explaining what each file did. Don't translate."` |
| `.claude/skills/migrate-nanoclaw/SKILL.md` | "Intent-based migration" — extract customizations into a guide, then re-apply on clean upstream in a worktree. Replaces merge-based upgrades. | A user about to upgrade a customized fork to a new upstream. | **Conditionally yes — as the *vehicle* for Path D.** The skill spec explicitly recognizes Tier 3 (many skills + deep source changes) which matches this fork. Its core flow (worktree, extract guide, replay) is the same pattern as the gauntlet plan. But it's a procedural skill, not a magic button — it will *still* need the answers in this report. |
| `.claude/skills/migrate-nanoclaw/diagnostics.md` | Opt-in PostHog event after migration. | Same as above. | Optional, irrelevant to porting decisions. |
| `.claude/skills/migrate-from-openclaw/SKILL.md` | Imports an OpenClaw install (a different project) into NanoClaw. | OpenClaw users, not v1 NanoClaw users. | **No.** Quote: `"Detects existing OpenClaw installation, extracts identity, channel credentials, scheduled tasks, and other config..."` — not for v1 → v2 NanoClaw forks. Ignore. |

**Verdict:** the right skill chain for this fork is `bash migrate-v2.sh` + `/migrate-from-v1` (the deterministic + human-judgment pair), **wrapped inside** the `/migrate-nanoclaw` worktree pattern so the source-side customizations are re-applied without merge conflicts. `/migrate-from-openclaw` is unrelated. See §2 for why `migrate-v2.sh` cannot be run wholesale on this fork.

---

## 2. Migration script forensics

### 2.1 `migrate-v2.sh` — top-level execution trace

| Phase | What runs | Mutates |
|---|---|---|
| 0a — Bootstrap | `bash setup.sh` (Node/pnpm install + native module check). Sets `STATUS` env. | Installs Node ≥20 if missing (via `setup/install-node.sh`), corepack-enables pnpm or `npm i -g pnpm@<pinned>`, `pnpm install --frozen-lockfile`. **No `.env` writes, no DB writes.** Aborts on `bootstrap` failure. |
| 0b — Find v1 | `NANOCLAW_V1_PATH` env var or sibling-dir scan for `*/store/messages.db`. Skips dirs with `package.json` version 2.x. | Read-only. Aborts on `v1-not-found`. |
| 0c — Validate v1 DB | `pnpm exec tsx scripts/q.ts "$V1_DB" "SELECT name FROM sqlite_master..."` then `SELECT COUNT(*) FROM registered_groups`/`scheduled_tasks WHERE status='active'`. | Read-only. Aborts on `v1-db-invalid` if `registered_groups` table is missing. |
| 1a — `setup/migrate-v2/env.ts` | Merges v1 `.env` into v2 `.env`. | **Writes** `.env` (appends a `# ── migrated from v1 ──` block, only keys not already present), **copies** `.env` → `data/env/env` (the container-readable copy). |
| 1b — `setup/migrate-v2/db.ts` | Seeds `data/v2.db` from v1 `registered_groups`. | **Creates** `data/v2.db` if absent, runs `runMigrations(db)`, inserts `agent_groups` / `messaging_groups` / `messaging_group_agents` rows. For Discord groups, hits Discord REST (`/users/@me/guilds`, `/guilds/<id>/channels`, `/channels/<id>`) using `DISCORD_BOT_TOKEN` to recover guild IDs. **Auto-flips an existing messaging_group's `unknown_sender_policy` to `'public'`** if it was previously created by the runtime router and has zero wired agent_groups. |
| 1c — `setup/migrate-v2/groups.ts` | Copies v1 `groups/<folder>/` into v2 `groups/<folder>/`. | **Renames** `CLAUDE.md` → `CLAUDE.local.md`. **Writes** `container.json` from v1's `registered_groups.container_config` JSON (or `.v1-container-config.json` sidecar if unparseable). Skips symlinks (broken `.claude-shared.md` v1 symlinks pointing at `/app/...`). Skip set: `CLAUDE.md`, `logs`, `.git`, `.DS_Store`, `node_modules`. **Never overwrites** existing v2 files. |
| 1d — `setup/migrate-v2/sessions.ts` | For each v1 session folder, creates a v2 session row + initializes its inbound.db/outbound.db. Copies `.claude/` per-folder state into `data/v2-sessions/<agent_group_id>/.claude-shared/`. | **Creates** sessions rows, session dirs, `inbound.db` + `outbound.db` files, **writes** `session_routing` rows. **Detects** the most-recent v1 Claude Code JSONL session ID and writes it into `outbound.db.session_state` as `continuation:claude` so the next agent run resumes that exact conversation. Also rewrites the projects directory key `-workspace-group` → `-workspace-agent` (v1 cwd → v2 cwd). |
| 1e — `setup/migrate-v2/tasks.ts` | Reads v1 `scheduled_tasks WHERE status='active'`, ports each as a `messages_in` row with `kind='task'` in the session inbound.db. | **Inserts** task rows via `insertTask()`. Maps `schedule_type` ∈ {`cron`,`interval`,`once`,`at`} → cron string; uses `process_after = next_run`. Skips tasks whose JID can't be resolved (incl. Discord channels the bot can't see). **Idempotent** — checks `SELECT id FROM messages_in WHERE id=? AND kind='task'` before inserting. |
| 2a — `setup/migrate-v2/select-channels.ts` | Clack multiselect (or `NANOCLAW_CHANNELS` env var). | **Writes** the selection (newline-separated) to `logs/migrate-steps/2a-channels-selected.txt`. No other state. |
| 2b — `setup/migrate-v2/channel-auth.ts` | For each selected channel, copies env keys per `CHANNEL_AUTH_REGISTRY` and on-disk auth files (Baileys keystore, Matrix store, etc.). | **Appends** env keys to v2 `.env` (never overwrites). **Copies** auth files (whatsapp: `data/sessions/baileys`, `data/baileys_auth`, `store/auth_info_baileys`, `store/baileys`, `auth_info_baileys`). Reports `MISSING:<channel>:<key>` lines for any `requiredV2Keys` that are absent. |
| 2c — `setup/install-<channel>.sh` per channel | Runs the bundled installer for each selected channel. | **`git fetch origin channels`** + **`git show channels:<file> > <file>`** for `src/channels/<name>.ts`, `setup/<name>-auth.ts`, `setup/groups.ts`; **appends** `import './<name>.js';` to `src/channels/index.ts`; **awk-injects** `groups: ...` and `'<name>-auth': ...` entries into `setup/index.ts`; **`pnpm install`** pinned versions of native deps (e.g. `@whiskeysockets/baileys@7.0.0-rc.9 qrcode@1.5.4 @types/qrcode@1.5.6 pino@9.6.0`); **`pnpm run build`**. Each step idempotent (re-running is a no-op). |
| 2d — (removed) | LID resolution — gone. Baileys v7 handles in adapter. | n/a |
| 3a — Docker | Installs Docker if missing (`bash setup/install-docker.sh`). | System-level install. |
| 3b — OneCLI | `curl http://127.0.0.1:10254/api/health`; if down, `pnpm exec tsx setup/index.ts --step onecli`. | Starts the OneCLI gateway. |
| 3c — Auth | If neither `ANTHROPIC_API_KEY` nor `CLAUDE_CODE_OAUTH_TOKEN` in `.env`, runs `--step auth`. | Adds Anthropic credential. |
| 3d — Container skills | Copies `<v1>/container/skills/<name>/` → `<v2>/container/skills/<name>/` for names not already present in v2. | **Recursive cp -r**. Skipped per-skill if v2 already has the directory. |
| 3e — `container/build.sh` | Builds the agent container image. | Docker image build. |
| Service switchover | Detects v1 service (`com.nanoclaw` plist on macOS, `nanoclaw.service` on Linux). Asks user via `switchover-prompt.ts`. If "switch": stops v1, runs `--step service`, asks keep/revert. | **`launchctl unload`** or **`systemctl --user stop && disable`** v1; **starts** v2 service with install-slug-unique name. Keeps v1 unit/plist on disk for one-command rollback. |
| Phase 4 — Handoff | EXIT trap writes `logs/setup-migration/handoff.json`. If `claude` is on PATH, `exec claude "/migrate-from-v1"`. | **Writes** `handoff.json`. |

### 2.2 Per-step assumptions vs fork reality

| Step | Upstream assumes | Fork reality | Verdict |
|---|---|---|---|
| 0c validation | `registered_groups` table exists. | ✅ Exists. | OK |
| 1a env | v1 `.env` exists; standard `KEY=VALUE` lines. | ✅ | OK |
| **1b-db** | `registered_groups` columns include `jid, name, folder, trigger_pattern, requires_trigger, is_main`. | ❌ **Fork has no `is_main` column.** `src/db.ts:85-93` CREATE TABLE lists only `jid, name, folder, trigger_pattern, added_at, container_config, requires_trigger`. The migration's SELECT will throw `no such column: is_main`. | **BLOCKER** |
| 1b-db | `container_config` is JSON-parseable; if not, written as sidecar. | ✅ Fork stores JSON or NULL. | OK (but see groups.ts) |
| 1b-db | `unknown_sender_policy='public'` is what the user wants after migration. | Fork has its own sender allowlist (`src/sender-allowlist.ts`, `data/sender-allowlist.json`). **Not migrated.** | Manual reconciliation needed in `/migrate-from-v1` skill |
| 1c groups | v1 group folders are simple files (skips symlinks, `.git`, `logs`). | Fork has `groups/.gitignore` (commit `c4a9543`) and per-group `.git`/various — mostly fine. | OK but expect noise |
| 1d sessions | `data/sessions/<folder>/.claude/` directory layout. | Fork uses same path. ✅ | OK |
| 1d sessions | Resumed claude session IDs are JSONL files under `-workspace-group/`. | ✅ | OK |
| **1e tasks** | `scheduled_tasks` columns: `id, group_folder, chat_jid, prompt, schedule_type, schedule_value, next_run, status, context_mode, script`. | Fork extends with `last_run, last_result, model, suppress_chat_output`. Upstream tasks.ts (`SELECT *`) reads them all but **only preserves `script` and `context_mode`** in the migrated content JSON. **Drops `model` and `suppress_chat_output` silently.** | **DATA LOSS** — fork's per-task model assignment and the suppress-chat-output gate (commit `bd59568`) are gone after migration |
| 1e tasks | `schedule_type` ∈ {cron, interval, once, at}. Interval values match `^(\d+)([smhd])$`. | Fork supports same plus `every_X_minutes`-style strings? Let me verify — `src/db.ts:54` doesn't constrain. Tests would catch deviations. | Verify per-task |
| 2c install scripts | `src/channels/<name>.ts` doesn't already exist. | **Fork has highly modified `src/channels/whatsapp.ts` and `src/channels/telegram.ts`.** Upstream installer does `git show origin/channels:... > <file>` which **overwrites** the fork's versions. | **DATA LOSS** — fork sticker support, voice transcription wiring, fork-specific reaction handling all clobbered |
| 2c install scripts | `src/channels/index.ts` is the v2 barrel that imports `./cli.js`. | Fork's `src/channels/index.ts` has `registerWhatsAppChannel()` / `registerTelegramChannel()` calls — incompatible barrel shape. | **CONFLICT** — install scripts assume v2 barrel |
| 3d container skills | v1 container skill names don't collide with v2's. | Fork ships `gauntlet`, `link-to-audio`, `pdf-reader`, `speak`, `triangulate`, `reactions`, `google-workspace`. Names don't collide with v2's `agent-browser`, `frontend-engineer`, `onecli-gateway`, `self-customize`, `slack-formatting`, `vercel-cli`, `welcome`. ✅ | OK — these will copy clean |
| Service switchover | v1 service name is `com.nanoclaw` (macOS) or `nanoclaw` (Linux). | ✅ Matches fork's install (see CLAUDE.md). | OK |

### 2.3 Things explicitly NOT handled by `migrate-v2.sh`

Quoted directly from upstream code or the skill:

- **Owner seeding** — `setup/migrate-v2/db.ts` header: `"Does NOT seed users/user_roles — the /migrate-from-v1 skill handles that."`
- **Chat / message history** — `docs/v1-to-v2-changes.md`: `"messages / chats tables (chat history) — not migrated. Stay in the v1 checkout if you need them."`
- **`router_state` key/value** — same doc: `"router_state (key/value) — not migrated."`
- **v1 sessions table** — same: `"sessions (v1 group→session_id) — v1 sessions don't map; v2 sessions are keyed by (agent_group_id, messaging_group_id, thread_id) and are created on demand."`
- **`task_audit_log`**, **`task_run_logs`** (fork-added) — not handled; will be left in v1's DB.
- **`reactions`** table (fork-added) — not handled.
- **Arena tables** (`arena_sessions`, `arena_logs`, `arena_grades`, `arena_aggregates`) — not handled; arena is fork-only.
- **Sender allowlist** (fork: `src/sender-allowlist.ts` + `data/sender-allowlist.json`) — not handled; needs Phase-1 access-policy reconciliation in `/migrate-from-v1`.
- **CLAUDE.local.md content cleanup** — script just writes the file; skill does the diff/keep/drop work in Phase 2.
- **OneCLI vault credential migration** — script registers Anthropic key only; the rest is `/init-onecli`.

### 2.4 `migrate-v2-reset.sh` (development-only)

Reverses what migrate-v2.sh did. Deletes `data/`, `logs/`, `.env`; `git checkout`s `groups/`, `container/skills/`, `src/channels/`, `setup/whatsapp-auth.ts`, `setup/pair-telegram.ts`, `setup/index.ts`, `package.json`, `pnpm-lock.yaml`; removes untracked skills/channels copied in by install scripts. Does NOT touch `node_modules/`, `setup/migrate-v2/*`, or the v1 install. **Read-only for the fork's perspective — we'd never run it.**

### 2.5 Recommendation: wholesale / selective / manual recipe?

**Use it as a manual recipe — do not run wholesale.** Reasons (in order):

1. Step 1b-db will throw on the missing `is_main` column → migration aborts early.
2. Step 2c install scripts overwrite the fork's customized channel files (sticker support, transcription hookup, fork-specific reactions).
3. Step 1e silently drops `model` and `suppress_chat_output` task columns.
4. The whole concept of `is_main=1` → privileged group needs reconciliation: fork relies on folder-name=='main'; v2 needs an explicit `user_roles.owner` row that nothing in the deterministic script writes.

Acceptable wholesale path **only if** all of the following are pre-applied to the v1 DB:
- `ALTER TABLE registered_groups ADD COLUMN is_main INTEGER DEFAULT 0` + `UPDATE registered_groups SET is_main=1 WHERE folder='main'`.
- A pre-step that captures `model` + `suppress_chat_output` from `scheduled_tasks` into a sidecar JSON the `/migrate-from-v1` skill can re-apply.
- The fork's `src/channels/whatsapp.ts` and `src/channels/telegram.ts` customizations are saved to `docs/v1-fork-reference/` *before* step 2c runs (or step 2c is skipped and channels are re-applied from upstream/channels manually after `/migrate-from-v1` Phase 4).

The "Builder agent" downstream should treat the migration as a **recipe**: borrow `env.ts`, `groups.ts`, `sessions.ts`, `tasks.ts` outputs directly; rewrite `db.ts` to handle the fork's schema; replace `2c install` with a fork-aware channel installer.

---

## 3. File mapping table — fork-modified files that upstream deleted

Method: `git log upstream/main --diff-filter=D -- <v1_path>` for each. Most deletions land in `9486d56` ("v2: make v2 the main entry point, move v1 to src/v1/") and the final cleanup in `86becf8` ("chore: delete v1 reference code"). The v2 entity model + two-DB session split is the load-bearing architectural shift.

| v1 path (fork has) | v2 path / replacement | Status | API changes summary |
|---|---|---|---|
| `src/db.ts` | **split** → `src/db/connection.ts`, `src/db/schema.ts`, `src/db/agent-groups.ts`, `src/db/messaging-groups.ts`, `src/db/sessions.ts`, `src/db/session-db.ts`, `src/db/dropped-messages.ts`, `src/db/container-configs.ts`, `src/db/migrations/index.ts` + `src/db/migrations/00*-*.ts` (15+ files), plus `src/state-sqlite.ts` (central DB helper). Fork-specific tables (`arena_*`, `task_audit_log`, `reactions`, fork-specific columns) have no v2 home. | split | Schema is fully different: `registered_groups` → `agent_groups` + `messaging_groups` + `messaging_group_agents`; `sessions` → v2 `sessions(agent_group_id, messaging_group_id, thread_id, container_status, last_active)`; `scheduled_tasks` → `messages_in` rows in per-session `inbound.db` with `kind='task'`; `users` + `user_roles` + `agent_group_members` are net-new. Per-session `inbound.db` / `outbound.db` are new files, not tables. |
| `src/ipc.ts` | **deleted-no-replacement** (host side). Behavior replaced by per-session SQLite IPC. | deleted-no-replacement | Closest analogues: host writes to `inbound.db.messages_in` (`src/session-manager.ts:writeSessionMessage`); container writes to `outbound.db.messages_out` (`container/agent-runner/src/db/messages-out.ts:writeMessageOut`); host reads outbound via `src/db/session-db.ts:openOutboundDb` + `syncProcessingAcks`. **No FS-based atomic-rename queue, no rate-limiting layer, no JSON envelope.** Outbound op vocabulary: `chat` / `edit` / `reaction` / `ask_question` / `card`. See §4 for the full spec. |
| `src/group-queue.ts` | **behavior-moved-into** `src/host-sweep.ts` + `src/container-runner.ts` + `src/host-core.test.ts`. The "one container per session at a time" guarantee is now structural (session row's `container_status` + heartbeat) rather than a queue. | behavior-moved-into-X | `host-sweep.ts` decides whether to wake/kill containers; `container-runner.ts` (lines 42, 151-172) tracks `heartbeatPath()`. Stuck detection: `getStuckProcessingIds()` (session-db.ts:184), `decideStuckAction()` (host-sweep.test.ts:13). Fork's `SlotState` + `slotIpcSubdir` + slot-prefix parsing (commits referencing `slots.ts`) — no v2 equivalent. |
| `src/task-scheduler.ts` | **behavior-moved-into** `src/host-sweep.ts` + `src/modules/scheduling/db.ts` + `src/modules/scheduling/recurrence.ts` + `src/modules/scheduling/actions.ts` + `container/agent-runner/src/mcp-tools/scheduling.ts`. | behavior-moved-into-X | v2 puts tasks as `messages_in` rows with `kind='task'`, `process_after`, `recurrence`, `series_id`. Host sweep wakes the container when `datetime(process_after) <= datetime('now')`. No separate scheduler process. Public API: `insertTask()` in `src/modules/scheduling/db.ts`. **Fork's credit-fallback `runContainerAgent` wrapper (commit `8d42685`) has no v2 site to live in.** |
| `src/claw-skill.test.ts` | **deleted-no-replacement.** v2 has no equivalent test; the `/claw` skill became a utility skill on the `skill/qmd` / channels branch space. | deleted-no-replacement | Drop. |
| `src/db.test.ts` | **split** → `src/db/db-v2.test.ts`, `src/db/session-db.test.ts`, `src/host-core.test.ts`, `src/modules/scheduling/db.test.ts`, `src/modules/permissions/permissions.test.ts`. Schema is unrelated; test cases must be rewritten. | split (none reusable) | Drop the fork's `db.test.ts` outright. |
| `src/group-queue.test.ts` | **behavior-moved-into** `src/host-sweep.test.ts` + `src/container-restart.test.ts`. | behavior-moved-into-X | Drop the fork's. |
| `src/ipc-auth.test.ts` | **deleted-no-replacement.** v2's session-DB IPC has no per-call auth — host owns inbound, container owns outbound, both via file-system permissions on the shared mount. | deleted-no-replacement | Drop. |
| `src/formatting.test.ts` | **moved** → `src/channels/chat-sdk-bridge.test.ts` (cross-platform formatting tests via Chat SDK) + `container/agent-runner/src/formatter.test.ts` (container-side text formatting). | moved (different content) | Drop the fork's; v2's `attachment-naming.test.ts` is also worth knowing. |
| `container/agent-runner/src/ipc-mcp-stdio.ts` | **deleted-no-replacement.** Replaced by `container/agent-runner/src/mcp-tools/*.ts` — separate files per tool category. Bun runtime. | deleted-no-replacement | Tools list now: `core.ts` (send_message, send_file, edit_message, add_reaction), `scheduling.ts`, `interactive.ts`, `self-mod.ts`, `cli.ts`, `agents.ts`. None of the fork's IPC tools (host_op, register_group, list_tasks JSON, generate_image, react_to_message, send_audio/document via stdio) survive. |
| `package-lock.json` | **deleted-no-replacement** (top-level). Replaced by `pnpm-lock.yaml`. Agent-runner uses `bun.lock`. | deleted-no-replacement | Different package manager. Fork must move to pnpm for the host and bun for the agent-runner. |

---

## 4. IPC replacement spec (CRITICAL)

### 4.1 Where v2 communication lives

| Direction | Mechanism | File(s) |
|---|---|---|
| Host → container | Insert row into `inbound.db.messages_in` (host-owned, `journal_mode=DELETE`, opened-written-CLOSED per op). Container reads on its poll cycle. | `src/session-manager.ts:writeSessionMessage`; `src/db/session-db.ts:insertMessage`. Schema in `src/db/schema.ts:INBOUND_SCHEMA`. |
| Container → host | Insert row into `outbound.db.messages_out` (container-owned). Host reads via `getStuckProcessingIds` / `syncProcessingAcks` / direct queries. | `container/agent-runner/src/db/messages-out.ts:writeMessageOut`; `src/db/session-db.ts:syncProcessingAcks`. |
| Container heartbeat | Touch a file. **Not** a DB write. | `src/session-manager.ts:heartbeatPath` (`{sessionDir}/.heartbeat`). |
| Container ack | `processing_ack` table in `outbound.db`. | `src/db/schema.ts:OUTBOUND_SCHEMA`. |
| Wake-on-write | Host writes `inbound.db.messages_in` row with `on_wake=1` for the very first poll after a fresh container start (used by self-mod approvals and explicit restarts). | `src/db/session-db.ts:insertMessage` (`onWake` field). |
| Routing override | `inbound.db.session_routing` (single-row table). Host overwrites on every wake from messaging_group + thread_id. | `src/db/session-db.ts:upsertSessionRouting`. |
| Destinations | `inbound.db.destinations` (many-row table). Host overwrites on wake; container queries live. | `src/db/session-db.ts:replaceDestinations`. |

Critical cross-mount invariants (`src/db/session-db.ts:9-18`):
1. `journal_mode=DELETE` — WAL's mmapped `-shm` doesn't refresh host→guest.
2. Host opens-writes-CLOSES per op — close invalidates the container's page cache.
3. One writer per file — concurrent writers across the mount corrupt the DB.

There is **no stdio pipe, no Unix socket, no MCP-over-stdio bridge to the host**. The container does run an in-process MCP server (`container/agent-runner/src/mcp-tools/server.ts`) but it lives entirely inside the container — host has no MCP transport. The host's only knowledge of agent activity is via `outbound.db` row writes.

### 4.2 Message envelope shape

**Inbound (host → container)** — `messages_in` row:
```ts
{
  id: string;             // 'msg-<ts>-<rand>'
  seq: integer (even);    // host uses even, container uses odd; monotonic via nextEvenSeq()
  kind: string;           // 'chat' | 'chat-sdk' | 'task' (and possibly more — extensible by writer)
  timestamp: ISO string;
  status: 'pending'|'processing'|'completed'|'failed'|'paused';
  process_after: ISO string | null;  // task wake gate
  recurrence: cron string | null;
  series_id: string;
  tries: integer (default 0);
  trigger: 0 | 1;         // 1 = wake agent, 0 = accumulate context only
  platform_id, channel_type, thread_id: string | null;  // routing
  content: TEXT (caller serializes; opaque to schema);
  source_session_id: string | null;  // agent-to-agent only
  on_wake: 0 | 1;         // only deliver on fresh-start poll
}
```
+ `delivered`, `destinations`, `session_routing` ancillary tables.

**Outbound (container → host)** — `messages_out` row:
```ts
{
  id: string;             // 'msg-<ts>-<rand>'
  seq: integer (odd);
  in_reply_to: string | null;
  timestamp: ISO string;
  deliver_after, recurrence: optional;
  kind: TEXT;             // 'chat' (almost always)
  platform_id, channel_type, thread_id: string | null;
  content: JSON TEXT — see operation vocabulary below
}
```
+ `processing_ack` table (`{message_id, status, status_changed}`), `session_state` (KV — `continuation:claude` etc.).

### 4.3 Message types — host outbound delivery vocabulary

From `src/channels/chat-sdk-bridge.ts:367-509` and `container/agent-runner/src/mcp-tools/core.ts`:

| Outbound op | Content shape | Native? | Notes |
|---|---|---|---|
| **Text chat** | `{ markdown?: string, text?: string }` (+ optional `files: [{filename, data}]` in adapter call) | ✅ Yes | Adapter splits at `maxTextLength` if set; files ride on first chunk. |
| **`operation: 'edit'`** | `{ operation:'edit', messageId, text|markdown }` | ✅ Yes | `adapter.editMessage(threadId, messageId, ...)`. |
| **`operation: 'reaction'`** | `{ operation:'reaction', messageId, emoji }` | ✅ Yes — but as `add_reaction` MCP tool, takes `seq` int + emoji shortcode (not raw char). | `container/agent-runner/src/mcp-tools/core.ts:222`. |
| **`type: 'ask_question'`** | `{ type:'ask_question', questionId, title, question, options:[...] }` | ✅ Yes | Adapter renders as Card+Actions buttons. |
| **`type: 'card'`** | `{ type:'card', card:{title, description, children, actions:[{label, url}]}, fallbackText }` | ✅ Yes | Send-card MCP tool exists. Non-URL actions dropped (fire-and-forget). |
| **File / image / audio / document** | `{ text/markdown, files: [{filename, data: Buffer}] }` | ✅ Yes (as **attachment**) | `send_file` MCP tool — copies into `/workspace/outbox/<id>/` then writes row referencing `files: [filename]`. WhatsApp adapter's `buildMediaMessage` (channels branch, `src/channels/whatsapp.ts:152`) picks image/video/audio/document from file extension. There is **no dedicated outbound `audio` op** — audio is just an attachment whose mimetype starts with `audio/`. |
| **Sticker** | n/a | ❌ **Not natively supported on outbound.** | WhatsApp adapter on the channels branch does not switch on a `'sticker'` op (only inbound `stickerMessage` parsing). The MCP tool surface has no `send_sticker`. The `attachment-naming.ts` test references `att.type==='sticker'` for *inbound* extension derivation. To send stickers, the channel adapter and MCP tool both need extending. |
| **Voice / audio op** | n/a | ❌ Only as attachment. | The Baileys `audio: data, mimetype:'audio/ogg'` send happens inside `buildMediaMessage` triggered by extension. No `voice` boolean → `ptt: true` mapping in the v2 adapter (it's an extension override that the fork hand-rolled). |
| **Typing indicator** | n/a — `adapter.setTyping(platformId, threadId)` called from `src/modules/typing/index.ts`. Not a `messages_out` row. | ✅ via adapter method | Side-channel, not IPC. |

### 4.4 Sticker / reaction / document send — go/no-go

| Capability | Native v2? | Evidence |
|---|---|---|
| Send text | YES | Default `kind:'chat'` row. |
| Send reaction | YES | `add_reaction` MCP tool (`core.ts:222`), `operation:'reaction'` in adapter (`chat-sdk-bridge.ts:381`, `whatsapp.ts:702` on channels branch). |
| Send document | YES (as `files` attachment with any extension) | `send_file` MCP tool. Adapter picks MIME from extension (`buildMediaMessage`). |
| Send image | YES (same as document; image extension routes to `image: data`). | Same. |
| Send audio (voice note semantics) | PARTIAL | Audio extension routes to Baileys `audio: data`. **Not** sent as `ptt:true` (push-to-talk voice note) — that's a fork-specific flag the upstream adapter doesn't set. |
| **Send sticker** | NO | No `send_sticker` tool; no `operation:'sticker'` branch in adapter; `buildMediaMessage` `.webp` extension routes to `image:` not `sticker:`. The fork's commit `940c147` adds **inbound** sticker handling (`.webp` → PNG conversion for vision), not outbound. |

**Is the message-type set extensible?**

Yes, but at two layers, both fork-touchable:

- **Container side (MCP):** the MCP tool registry is `registerTools([...])` in `core.ts:263`. A fork can add a `sendSticker` tool that writes a `messages_out` row with whatever content shape it wants.
- **Host side (adapter dispatch):** the `chat-sdk-bridge.deliver()` switch on `content.operation` / `content.type` is a literal `if` ladder. Adding a new branch is mechanical, but it has to happen on the channel branch's `src/channels/<channel>.ts` (NOT trunk — trunk has only `cli.ts`).

So: outbound stickers are achievable but require **changes to two layers** per fork-supported channel.

### 4.5 The fork's IPC tool surface — coverage matrix

From `container/agent-runner/src/ipc-mcp-stdio.ts`:

| Fork tool | v2 equivalent | Action required |
|---|---|---|
| `send_message` | `send_message` | Same name — but optional `sender` arg (sub-agent identity) is fork-only. |
| `react_to_message` | `add_reaction` | Different shape. `messageId` is `int seq` in v2 vs `string platform_id` in fork. |
| `schedule_task` | container MCP `scheduling.ts:schedule_task` | Different — v2 writes a `messages_in` task row in the *same session*, fork dispatches via IPC to host scheduler. |
| `list_tasks` / `pause_task` / `resume_task` / `cancel_task` | container MCP `scheduling.ts` | Should exist — verify. |
| `update_task` | likely supported (scheduling actions) | Verify; check `model` field carries through. |
| `register_group` | NO — replaced by `ncl messaging-groups create` + `ncl wirings add` (admin CLI) | Re-architect: no agent-driven registration. Fork must use `ncl` from inside container, which has approval gating (`cli_scope`). |
| `host_op` (read sender-allowlist + system commands) | NO native equivalent | Either implement via `mcp-tools/self-mod.ts`'s install_packages flow or drop. v2's privilege model is `user_roles`, not host shell. |
| `generate_image` (gpt-image-2 via LiteLLM) | NO | Fork-only. Port as a custom MCP tool. |

---

## 5. Behavioral overlap check

| Customization | Verdict | Evidence |
|---|---|---|
| **Credit-error fallback (529, "Credit balance is too low", cross-provider)** | **DOES-NOT-EXIST.** v2 has *no* cross-provider error fallback. Greps `'credit|529|balance is too low|isCreditError|gemini.*fallback|fallback.*model'` in `upstream/main src/` return **zero** matches. Closest analogue: `src/circuit-breaker.ts` is a *startup* circuit breaker (state file at `data/circuit-breaker.json`) for repeated process crashes, not a provider-call error gate. | `git grep ... upstream/main src/` → no hits. Fork's `src/oauth-refresh.ts:274 export function isCreditError(stderr: string)` and `src/index.ts:86,748,767`, `src/task-scheduler.ts:28` have no upstream counterpart. **Port required.** |
| **BLOB→TEXT prompt coercion** (commit `8d42685` BLOB prompt coercion guard) | **DOES-NOT-EXIST.** Grep `'BLOB\|String\(.*prompt\|Buffer.isBuffer.*prompt'` in `upstream/main` `src/modules/scheduling/`, `src/state-sqlite.ts`, `src/db/` returns no hits. v2's task payload lives in `messages_in.content TEXT` (`src/db/schema.ts:160-180`) — a TEXT column, set via `insertTask({content: JSON.stringify(...)})` — so the Buffer-from-BLOB coercion problem the fork hit doesn't physically reproduce. | `git grep` → zero. The fork's coercion guard is a v1-DB-specific bug fix; v2's schema architecturally avoids it. **Drop the patch.** |
| **Crash-safe transcripts** (exit-time archiving) | **PARTIAL-OVERLAP.** v2 has a PreCompact hook (`container/agent-runner/src/providers/claude.ts:114-228`) that archives transcripts on compaction — written to `conversationsDir/<filename>` with `sessions-index.json`. But this is *compaction-only*, not exit-time / SIGTERM-driven. Fork's "exit-time archiving for crashed/killed sessions" (per memory note `project_crash_safe_transcripts`) has no v2 SIGTERM handler. | `container/agent-runner/src/providers/claude.ts:114, 142, 194, 225`. **Re-port the SIGTERM half** if the fork wants on-crash archiving. |
| **Agent drift safeguards** (24h session rotation, skill-hash invalidation) | **DOES-NOT-EXIST.** Grep `'rotation\|rotate.*session\|skill.*hash\|invalidate.*session\|maxAge\|session.*ttl'` in `upstream/main src/` returns nothing structural. v2 sessions have `last_active` (`src/types.ts`, `src/db/schema.ts:99`) but no rotation logic. The fork's `sessions.created_at` + `sessions.skills_hash` columns (added by `src/db.ts:177-188`) have no v2 home. | Fork commit `9845ce4 feat: add session safeguards to prevent agent instruction drift`. **Port required.** |
| **LiteLLM / cross-provider routing** | **DOES-NOT-EXIST in trunk, partial in skills.** `upstream/main src/` and `container/` have *no* LiteLLM references. `ANTHROPIC_BASE_URL` is set in `src/providers/claude.ts:21-24` from `.env` — that's the only env-override path. The `/add-ollama-provider`, `/add-opencode`, `/add-codex` skills use `ANTHROPIC_BASE_URL` redirection per-group (via `container.json.env`). | `src/providers/claude.ts`; `docs/ollama.md`. **No per-call cross-provider fallback** like the fork's gemini-2.5-flash → DeepSeek → gpt-4o-mini chain. The fork's LiteLLM proxy + arena routing is fork-specific. |
| **Per-group model + effort overrides** | **EXISTS-NATIVELY.** Set via `ncl groups config update --model <model> --effort <level>`. Stored in `container_configs` table (migration `014-container-configs.ts`). Read by `src/container-config.ts:45 effort?: string`. CHANGELOG `[2.0.54]`. | `src/cli/resources/groups.ts:126,136,141; src/db/container-configs.ts:7,30; src/db/migrations/014-container-configs.ts:13`. **Use this directly; do not port the fork's per-task `model` column separately — re-encode in container_config.** |
| **Stuck detection + heartbeat** | **EXISTS-NATIVELY.** `decideStuckAction()` in `src/host-sweep.ts` (tests at `src/host-sweep.test.ts`). Heartbeat is file touch (`src/session-manager.ts:heartbeatPath`). Container claim tracking via `getStuckProcessingIds()` (`src/db/session-db.ts:184`). `CLAIM_STUCK_MS` constant; tolerance widens for long-running bash via a heartbeat-driven extension (`src/db/schema.ts:257`). | Cited above. **Do not port** the fork's status-tracker.ts wholesale — refactor to use v2's heartbeat. |
| **Unknown-sender / unknown-channel permissions** | **EXISTS-NATIVELY and is core architecture.** `messaging_groups.unknown_sender_policy ∈ {strict, request_approval, public}` (`src/db/schema.ts:24-32`). Module: `src/modules/permissions/` — `access.ts`, `channel-approval.ts`, `sender-approval.ts`, plus DB helpers under `db/`. Approval flow primitives: `src/modules/approvals/`. **Replaces** the fork's sender-allowlist with a richer model. | `src/modules/permissions/index.ts:127,132,143,175`. **Drop the fork's `src/sender-allowlist.ts`**; map the allowlist into v2's `unknown_sender_policy + agent_group_members` model during `/migrate-from-v1` Phase 1. |

---

## 6. Channel skill-branch architecture

1. **Channel discovery.** Trunk's `src/channels/index.ts` is a *self-registration barrel* (`src/channels/index.ts:8` — `import './cli.js';`). Each `/add-<channel>` install script appends `import './<name>.js';` to that file. Channels self-register on import via `registerChannelAdapter(name, registration)` (`src/channels/channel-registry.ts:27`). Startup calls `initChannelAdapters(setupFn)` which iterates the registry, calls each `factory()`, and skips adapters that return null (missing credentials). **No config file, no manifest scanning, no ENABLED_CHANNELS env.**

2. **Channel installation.** `bash setup/install-<channel>.sh` from inside the v2 checkout. Each script: `git fetch origin channels`, `git show origin/channels:<file> > <file>` (overwriting!), append the registry import, `pnpm install <pinned-deps>`, `pnpm run build`. Each is idempotent — re-running with all files present is a no-op (`STATUS: already-installed`). See `setup/install-whatsapp.sh` quoted in §2.

3. **Source URL configurability.** **Hardcoded to `origin/channels`** — every `install-*.sh` uses `git fetch origin channels` and `git show origin/channels:...`. There is **no env var, no flag, no config file** that swaps in a different remote. To use a fork of the channels source (e.g. a fork of `nanoclaw-whatsapp`/`nanoclaw-telegram`), the install script must be patched, **or** the user must rename their fork's remote to `origin` and point its `channels` branch at the fork's commits. Most-tractable workaround: add a `channels` ref to `origin` (your fork's repo) that mirrors upstream's `channels` branch plus your local additions.

4. **Channel API surface — what must a channel skill export?** Defined by `ChannelAdapter` and `ChannelRegistration` in `src/channels/adapter.ts`:

   Required exports:
   - One file at `src/channels/<name>.ts` that calls `registerChannelAdapter(name, { factory })` at module top level.
   - `factory: () => ChannelAdapter | Promise<ChannelAdapter> | null` — returning `null` means "credentials missing, skip me".
   - The `ChannelAdapter` must implement:
     - `name: string`
     - `channelType: string` — used as the row's `channel_type`
     - `supportsThreads: boolean` — true for Discord/Slack/Linear/GitHub; false for Telegram/WhatsApp/iMessage
     - `setup(config: ChannelSetup): Promise<void>` — receives `onInbound`, `onInboundEvent`, `onMetadata`, `onAction` callbacks
     - `teardown(): Promise<void>`
     - `isConnected(): boolean`
     - `deliver(platformId, threadId, message: OutboundMessage): Promise<string | undefined>` — returns platform message ID for edit/react tracking
   - Optional: `setTyping`, `syncConversations`, `resolveChannelName`, `subscribe`, `openDM`.
   - Optional `containerConfig` in the registration block (`{ mounts: [...], env: {...} }`) — forwarded to `container-runner` for any session using this channel.

5. **README on `upstream/channels`.** The branch is a **flat tree of skill SKILL.md + setup .sh files**, not a packaged module — no top-level README beyond the per-channel `SKILL.md` / `REMOVE.md` / `VERIFY.md` triples. Each `add-<channel>/SKILL.md` is the install guide; each `setup/install-<channel>.sh` is the runnable script.

**Verdict:** the fork's channel re-port has a clean target — copy `src/channels/whatsapp.ts` and `src/channels/telegram.ts` from `upstream/channels`, **diff against fork's current `src/channels/whatsapp.ts` and `src/channels/telegram.ts`**, port the *delta* (sticker handling, voice transcription wiring, fork-specific message-formatting), then plug into v2's `ChannelAdapter` interface (different shape — fork's adapters return event handlers; v2's are registered via `registerChannelAdapter`).

---

## 7. Dependency delta

| Dimension | v1 (4383e3e) | Fork (origin/main) | v2 (upstream/main) | Notes |
|---|---|---|---|---|
| Node engines | `>=20` | `>=20` | `>=20` | Same. |
| `.nvmrc` upstream | n/a | n/a | **`22`** (single line) | New: v2 has a `.nvmrc` pinning Node 22. Fork has none. |
| Package manager | npm (`package-lock.json`) | npm (`package-lock.json`) | **`pnpm@10.33.0`** (`packageManager` field + `pnpm-lock.yaml`) | **Major switch.** Fork must adopt pnpm; `pnpm install --frozen-lockfile` is what setup.sh runs. |
| Host `@anthropic-ai/claude-agent-sdk` | only in agent-runner | only in agent-runner | only in agent-runner | Host doesn't import the SDK — agent-runner does. |
| agent-runner `@anthropic-ai/claude-agent-sdk` | `^0.2.76` | `^0.2.76` | `^0.2.128` | 52 minor patch bumps. Likely compatible (same `0.2.x` line) but the SDK has shipped Sonnet 4.7 & new hooks in this window. |
| `better-sqlite3` | `11.10.0` (pinned in 1.2.35) but fork shows `^11.8.1` | `^11.8.1` | `11.10.0` (exact pin) | Fork range allows 11.8.1+; v2 pins exact. ABI-compatible. Rebuild required after Node upgrade. |
| `@onecli-sh/sdk` | `^0.2.0` | `^0.2.0` | **`^0.5.0`** | 3 minor versions. May require code changes — check OneCLI integration calls. |
| `chat` (Chat SDK) | absent | absent | **`^4.24.0`** (new) | New required dep: powers `src/channels/chat-sdk-bridge.ts`. ~30 channels rely on it. |
| `cron-parser` | `^5.5.0` | `^5.5.0` | `5.5.0` (exact) | Same major. |
| `@clack/core`, `@clack/prompts` | absent | absent | **`^1.2.0`** (new) | Interactive prompts (channel selection, switchover). |
| `kleur` | absent | absent | **`^4.1.5`** (new) | ANSI colors. |
| `tsx` | `^4.19.0` | `^4.19.0` | `^4.19.0` | Same. |
| `typescript` | `^5.7.0` | `^5.7.0` | `^5.7.0` | Same. |
| `vitest` | `^4.0.18` | `^4.0.18` | `^4.0.18` | Same. |
| `@vitest/coverage-v8` | `^4.0.18` | `^4.0.18` | **REMOVED** | Drop. |
| `pino`, `pino-pretty` | `^9.6.0`, `^13.0.0` | `^9.6.0`, `^13.0.0` | **REMOVED** (v2 has built-in `src/log.ts`) | Fork uses `pino` in: `src/logger.ts:1`, `src/whatsapp-auth.ts:11`, `src/mount-security.ts:12`, plus container-runner. Per CHANGELOG `[1.2.36]`: "Replaced pino logger with built-in logger." **All fork files importing `pino` need to be ported to `src/log.ts`** — the migration is mechanical (`{ logger }` → `{ log }`) but every call site needs an arg-order swap. |
| `yaml` | `^2.8.2` | `^2.8.2` | **REMOVED** | Fork must check usages (none found in `src/` greps — likely safe to drop). |
| `zod` | `^4.3.6` | `^4.3.6` | **REMOVED** from host `package.json`; kept in `container/agent-runner/package.json` (`^4.0.0`). | Container-side only in v2. Fork uses `zod` in `container/agent-runner/src/ipc-mcp-stdio.ts:9` and `container/agent-runner/src/gws-mcp-stdio.ts:19` — both container-side, safe. |
| `@whiskeysockets/baileys` | absent (channel skill) | `^7.0.0-rc.9` | absent (lives on `upstream/channels`) | Fork's host imports Baileys directly in `src/whatsapp-auth.ts`, `src/image.ts`, `src/transcription.ts`, `src/channels/whatsapp.ts`. In v2, Baileys lives on `channels` branch + is installed per-channel by `setup/install-whatsapp.sh`. |
| `grammy` | absent | `^1.41.1` | absent | Fork's Telegram. v2 channels use Chat SDK (Telegram is `@chat-adapter/telegram` via the `chat` umbrella package). |
| `openai` | absent | `^6.27.0` | absent | Fork's OpenAI Whisper transcription. Loaded dynamically in `src/transcription.ts:65` (`await import('openai')`). |
| `qrcode`, `qrcode-terminal` | absent | `^1.5.4`, `^0.12.0` | absent | Fork's WhatsApp pairing. v2 installs `qrcode` only via `setup/install-whatsapp.sh`. |
| `socks-proxy-agent` | absent | `^9.0.0` | absent | Fork's SOCKS proxy for OAuth refresh through Synology NAS. Not in v2. |
| `@types/qrcode-terminal`, `@types/better-sqlite3` | absent | present | absent (better-sqlite3 types are present) | Type-only deps for fork. |
| `tsconfig.json` `target` / `module` / `lib` | `ES2022` / `NodeNext` / `ES2022` | `ES2022` / `NodeNext` / `ES2022` | **identical** | No changes. Arena's TS code (`src/arena/*`) is compatible by target. |
| `tsconfig.json` exclude | `["node_modules", "dist"]` | `["node_modules", "dist"]` | **identical** | Same. |

**Files in this fork that import a removed-from-v2 dep:**

| Fork file | Removed dep | Action |
|---|---|---|
| `src/logger.ts` | `pino` | Replace with `src/log.ts` interface. |
| `src/whatsapp-auth.ts` | `pino`, `qrcode-terminal`, `@whiskeysockets/baileys` | Move to `setup/whatsapp-auth.ts` on the channels branch (already exists upstream — diff and merge). |
| `src/mount-security.ts` | `pino` | Replace with `log`. |
| `src/oauth-refresh.ts` | `socks-proxy-agent`, `pino` (via logger) | Fork-specific; if kept, declare `socks-proxy-agent` as a fork-only dep in the re-installed `package.json`. |
| `src/image.ts` | `@whiskeysockets/baileys` (type-only) | Either keep with the import added back, or refactor to a non-Baileys signature. |
| `src/transcription.ts` | `@whiskeysockets/baileys`, dynamic `openai` | Keep as fork-only utility; declare `openai` (and Baileys types) in fork's `package.json`. |
| `src/channels/whatsapp.ts` | `@whiskeysockets/baileys` | Replaced wholesale by `upstream/channels:src/channels/whatsapp.ts`; port the *fork delta* (sticker, transcription hook, etc.) onto that base. |
| `src/channels/telegram.ts` | `grammy` | Replaced by `upstream/channels:src/channels/telegram.ts` (which uses Chat SDK, not Grammy). Port the fork's bot pool / arena routing onto that base. |
| `src/arena/index.ts` | `grammy` | Arena depends on Grammy for the Telegram bot pool. Either re-declare `grammy` as a fork dep or rewrite to use Chat SDK's Telegram adapter (which doesn't expose bot-pool semantics — likely requires keeping `grammy` as a fork-only direct dep). |

---

## 8. Cross-domain dependency matrix (parallel porting safety)

### 8.1 Domain → fork-file mapping

- **Core domain** (Porter-Core): `src/index.ts`, `src/router.ts`, `src/task-scheduler.ts`, `src/container-runner.ts`, `src/container-runtime.ts`, `src/group-queue.ts`, `src/ipc.ts`, `src/db.ts`, `src/oauth-refresh.ts` (because credit-fallback lives here).
- **Channels domain** (Porter-Channels): `src/channels/whatsapp.ts`, `src/channels/telegram.ts`, `src/channels/registry.ts`, `src/channels/index.ts`, `src/whatsapp-auth.ts`, channel tests.
- **Features domain** (Porter-Features): `src/arena/*` (11 files), AnyList wiring (PKA integration), link-to-audio container skill, gauntlet/triangulate container skills, PKA-onboarding, gws-mcp-stdio container code.
- **Utils domain** (Porter-Utils): `src/host-ops.ts`, `src/slots.ts`, `src/text-styles.ts`, `src/transcription.ts`, `src/status-tracker.ts`, `src/image.ts`.

### 8.2 Import matrix (rows import columns)

Method: `grep -rn "from '\./..." src/<owning-files>`. A cell value means "files in row's domain import from column's domain"; ∅ means no edge.

|  | → Core | → Channels | → Features | → Utils |
|---|---|---|---|---|
| **From Core** | (intra) | `src/router.ts` references channel registry abstractly (none direct in greps); `src/index.ts` indirectly via registry | ∅ — Core doesn't directly import `src/arena/*` | `src/index.ts:67` → `text-styles`; `src/index.ts:81` → `image`; `src/index.ts:82` → `status-tracker`; `src/index.ts:89` → `oauth-refresh` (intra-core); `src/index.ts:90` → `slots`; `src/router.ts:3` → `text-styles`; `src/task-scheduler.ts:28` → `oauth-refresh` (intra-core); `src/ipc.ts:16` → `host-ops`; `src/group-queue.ts:12` → `slots`; `src/container-runner.ts:35` → `oauth-refresh` (intra-core). |
| **From Channels** | `src/channels/whatsapp.ts:23-45` → `../config`, `../db`, `../logger`, `../types` (intra-core via fork's monolith); `src/channels/telegram.ts:7-17` → `../config`, `../env`, `../logger`, `../types`. | (intra) | ∅ | `src/channels/whatsapp.ts:36` → `../image`; `src/channels/whatsapp.ts:39` → `../transcription`; `src/channels/telegram.ts:10` → `../transcription`. |
| **From Features** | `src/arena/arena-aggregator.ts:9` → `../logger`; `src/arena/arena-config.ts:7` → `../config`; `src/arena/index.ts:15` → `../db` (uses `getDatabase()`); `src/arena/index.ts:31` → `../config`. Arena also imports `grammy` directly (channel dep, not core). | `src/arena/index.ts:11 import { Api, Bot } from 'grammy'` — Arena owns its own Telegram bot pool, not the channels adapter. | (intra) | ∅ |
| **From Utils** | `src/transcription.ts:11` → `./env` (intra-core); `src/host-ops.ts:10` → `./config`; `src/host-ops.ts:11` → `./logger`; `src/status-tracker.ts:4-5` → `./config`, `./logger`; `src/oauth-refresh.ts:14-15` → `./config`, `./logger`. | ∅ | ∅ | (intra) |

### 8.3 Couplings that break Porter parallelism

1. **Core ↔ Utils — entrenched.** `src/index.ts` and `src/router.ts` import 4+ utils modules each. Porter-Core cannot finish without `text-styles`, `image`, `status-tracker`, `slots`, and `oauth-refresh` being ported first (or stubbed). **Recommendation: Porter-Utils runs *before* Porter-Core**, not in parallel; OR Porter-Core ships a temporary stub layer. Given that v2 already has built-in equivalents for `status-tracker` (heartbeat) and `oauth-refresh` (OneCLI), Porter-Utils should map fork utilities to v2 primitives where possible, leaving Porter-Core with a smaller "novel utils" set.
2. **Channels ↔ Utils.** `src/channels/whatsapp.ts` and `src/channels/telegram.ts` import `transcription.ts` and `image.ts`. **Recommendation: have Porter-Utils finalize `transcription.ts` and `image.ts` first**; Porter-Channels can run in parallel with Porter-Features once those two utils land.
3. **Features ↔ Core.** `src/arena/index.ts:15 import { getDatabase } from '../db.js'`. Arena writes directly to fork's `messages.db`. In v2 the DB is `data/v2.db` (central) + per-session `outbound.db`. Arena cannot keep using `getDatabase()` because that function disappears with `src/db.ts`. **Recommendation: Porter-Features owns the Arena DB re-port** — either keep a dedicated `arena.db` (separate sqlite file) or rebuild on v2's central DB with new migrations.
4. **Features ↔ Channels.** Arena imports `grammy` directly (`src/arena/index.ts:11`). It doesn't go through fork's `src/channels/telegram.ts` — it bypasses for the bot-pool semantics. This is *not* a cross-domain edge that blocks parallel work, but it means **Arena's Telegram dependency is independent of the channel adapter port**: Arena keeps `grammy`, channels move to Chat SDK. Two independent Telegram client libraries will end up loaded.

### 8.4 Recommended sequencing

```
Phase 1a (sequential): Porter-Utils does transcription + image first
Phase 1b (parallel):
  ├─ Porter-Core      (rebuild on v2's central + session DBs)
  ├─ Porter-Channels  (re-base whatsapp.ts + telegram.ts on upstream/channels)
  └─ Porter-Features  (re-host arena on separate sqlite or v2 central; re-port container skills)
Phase 1c (sequential): Porter-Utils completes status-tracker/oauth-refresh/slots/text-styles/host-ops on v2 primitives
```

---

## 9. Setup / first-run flow (new-setup-2)

`setup.sh` is **bootstrap only** — it does Node/pnpm install + native-module checks and emits a status block. It does **not** do anything channel-, container-, or service-specific. See §2.1 phase 0a for what it touches.

Real setup state-machine lives in `setup/index.ts` and dispatches by `--step <name>`:

| Step | Effect | Reads | Writes |
|---|---|---|---|
| `timezone` | Detects + sets timezone. | system, `.env`. | `.env` (`TZ=...`). |
| `set-env` | Sets a single env var. | args. | `.env`. |
| `environment` | System check (Node, dirs). | system. | none (read-only). |
| `container` | Builds the agent container image (calls `container/build.sh`). | source. | Docker image. |
| `register` | Registers an agent group + assistant name. | args. | `data/v2.db.agent_groups`, `.env` (`ASSISTANT_NAME`), `CLAUDE.md` templates. |
| `pair-telegram` | Telegram pairing flow. | args. | `.env` (TELEGRAM_BOT_TOKEN). |
| `groups` | Channel-specific group sync (e.g. WhatsApp). | `data/v2.db`. | `data/v2.db.messaging_groups`. |
| `whatsapp-auth` | Baileys QR/pairing-code auth. | env, args. | `store/auth/`. |
| `signal-auth` | Signal pairing. | env, args. | session state. |
| `mounts` | Mount allowlist (`src/modules/mount-security/`). | args. | `data/mount-allowlist.json`. |
| `service` | Installs + starts platform service (launchd/systemd) with install-slug-unique name. | platform. | `~/Library/LaunchAgents/<slug>.plist` or `~/.config/systemd/user/<slug>.service`; starts it. |
| `verify` | End-to-end health check. | all of the above. | nothing. |
| `onecli` | Installs OneCLI gateway. | system. | docker container. |
| `auth` | Adds Anthropic credential to vault. | user input. | OneCLI vault (not `.env`). |
| `cli-agent` | Per-fork: customizes the in-container CLI agent. | args. | `data/v2.db.container_configs`. |

There is **also** `setup/auto.ts` (referenced by `npm run setup:auto`) — an automated end-to-end flow. Reading the relevant block (`setup/auto.ts:716` cites it): it discovers `NANOCLAW_ANTHROPIC_BASE_URL` to wire a custom-base-URL credential through the proxy. Full read needed if Builder wants to use it.

### 9.1 Initial state expected by setup

- **Empty `data/` dir** (or no `data/v2.db`) — setup creates them via `runMigrations()`.
- **Existing `.env`** is fine (setup appends, never overwrites).
- **Empty `groups/`** is fine; `setup --step register` creates a folder + scaffolds CLAUDE.md.
- **Existing source tree** must be the v2 layout — setup steps `import` from `src/db/connection.js`, `src/install-slug.js`, etc.

### 9.2 Overlap with `migrate-v2.sh`

`migrate-v2.sh` calls (via `pnpm exec tsx setup/index.ts --step <name>`) the following setup steps: `onecli`, `auth`, `service`. The `1a-1e` migration steps under `setup/migrate-v2/` are independent of `setup/<step>.ts`. **Post-migration, the install should look like a `setup/index.ts --step verify` would pass.** Gaps to verify by hand:

- `mounts` step is NOT called by `migrate-v2.sh` — if the fork has custom mounts (Arena DB, PKA, OAuth proxy cert), `setup/migrate-v2/groups.ts` writes them into `container.json` from v1's `container_config`, but the `mount-allowlist.json` on the host is separate and isn't seeded. Run `pnpm exec tsx setup/index.ts --step mounts` after migration.
- `register` is NOT called — agent groups come from `migrate-v2/db.ts`. Owner role is seeded by `/migrate-from-v1` skill Phase 1, not by setup `register`.
- `cli-agent` is NOT called — fork's per-group `model` field needs to be re-applied via `ncl groups config update --model <model>` for every group that had a custom model.
- `pair-telegram` / `whatsapp-auth` — handled by `setup/install-<channel>.sh`'s caller, which `migrate-v2.sh` invokes via step 2c. **But these only fire if the channel was selected** in step 2a — if the user skips channel selection (a common pattern when testing), the auth state copy from 2b still happens but the install scripts don't run, leaving the channel half-installed.

### 9.3 `.env` overwrite behavior

- `setup.sh`: no `.env` writes.
- `setup/timezone.ts`, `set-env.ts`: append-only (never overwrites).
- `setup/migrate-v2/env.ts`: append-only — only adds keys not already present.
- `setup/migrate-v2/channel-auth.ts`: append-only — same behavior.
- **No setup step overwrites `.env` keys.** Safe by design.

### 9.4 OneCLI interaction

- `migrate-v2.sh` phase 3b checks `curl http://127.0.0.1:10254/api/health`; if down, runs `setup --step onecli`.
- `setup --step onecli`: installs the OneCLI container, sets up the agent vault. Calls into `@onecli-sh/sdk@^0.5.0`.
- `setup --step auth`: pulls user's Anthropic key into the vault (not `.env`).
- Per CHANGELOG `[2.0.0]`: "OneCLI Agent Vault is the sole credential path. Containers never receive raw API keys; credentials are injected at request time." The fork's existing OneCLI setup (per memory note `reference_onecli_secret_management`) should reuse via the same vault — no re-pairing needed.

---

## 10. Open Questions for Noam

Questions Scout could not answer from upstream code alone:

1. **The fork's v1 DB has no `is_main` column. What's the right pre-patch?**
   Options: (a) ALTER TABLE on the v1 DB before migration (`ADD COLUMN is_main INTEGER DEFAULT 0; UPDATE ... SET is_main=1 WHERE folder='main';`); (b) patch `setup/migrate-v2/db.ts` to tolerate the missing column; (c) write a fork-specific replacement for db.ts. Builder agent will need this decision before drafting Phase 1.

2. **Sender allowlist → unknown_sender_policy mapping.**
   Fork's `data/sender-allowlist.json` is a flat per-JID list. v2's `messaging_groups.unknown_sender_policy ∈ {strict, request_approval, public}` is per-messaging-group, and "known" senders live in `agent_group_members`. For chats where the allowlist had N senders, do we want them all imported as `agent_group_members` rows + flip the messaging group to `strict`, or import as `request_approval` and let the human approve in-band? The `/migrate-from-v1` skill Phase 1c covers this but needs your call upfront.

3. **`scheduled_tasks.model` and `suppress_chat_output` columns.**
   Upstream's `tasks.ts` migration drops these. The `model` field can be re-encoded as a per-group `container_configs.model` (v2 supports per-group, but **not per-task** model). For tasks that need a specific model (gemini-2.5-flash, etc.), is per-group OK, or do we need a per-task override mechanism that doesn't exist in v2? Same for `suppress_chat_output` — is there a v2 way to gate chat output per task, or does this go into the task's content JSON as a flag the agent has to honor itself?

4. **Outbound sticker support priority.**
   v2 has no `send_sticker` op. The recent fork commit `940c147` added *inbound* sticker handling (vision). Is there an outbound use case that justifies extending the v2 MCP tool surface, or is inbound-only acceptable post-migration?

5. **Arena's grammy dependency.**
   Arena keeps its own `grammy`-based Telegram bot pool independent of the channel adapter. In v2, channels go through Chat SDK (no bot-pool primitive). Options: (a) keep `grammy` as a fork-only direct dep, Arena owns its bot init; (b) rewrite Arena to use Chat SDK and accept one bot identity (losing the 5-bot persona thing); (c) extend Chat SDK Telegram adapter with bot-pool support upstream. (a) is the safe path — confirm?

6. **OAuth-refresh through Synology SOCKS proxy.**
   `src/oauth-refresh.ts` + `socks-proxy-agent` keeps your OAuth refresh path working through a Synology NAS to bypass Cloudflare blocks. v2 uses OneCLI as the credential path. Does OneCLI's outbound HTTP go through your same SOCKS proxy, or does the credential-refresh edge case still need a host-side proxy layer? If the latter, where does it slot into v2's flow?

7. **PKA + AnyList + GWS — Phase 2 vs Phase 1.**
   The PKA integration, AnyList MCP, GWS MCP, Hue/Sonos plans are clearly Phase 2 (per the gauntlet plan §2 Drop-List they're not on the day-1 critical path). Confirm we're shipping Phase 1 with **no** PKA / AnyList / GWS — meaning the bot won't be able to access your calendar, vault, or task system until Phase 2 lands. OK?

8. **Channels source URL.**
   `setup/install-<channel>.sh` is hardcoded to `git fetch origin channels`. To use your forks of `nanoclaw-whatsapp` / `nanoclaw-telegram`, do we (a) maintain a `channels` branch on origin (your fork repo) that mirrors upstream/channels + your patches, or (b) patch `install-*.sh` to take a `NANOCLAW_CHANNELS_REMOTE` env var? (a) is fork-safe and surgical; (b) is upstream-mergeable. Recommend (b) as a small PR to upstream and (a) as the local workaround.

9. **Apple Container vs Docker.**
   The fork (per `convert-to-apple-container` skill) supports Apple Container as an alternative on macOS. v2 default is Docker; Apple Container is an opt-in skill (still on `upstream/skill/apple-container`). Phase 1 sticks to Docker?

10. **Crash-safe transcripts.**
    v2 has compaction-time transcript archiving but no SIGTERM/exit-time half. The fork's `project_crash_safe_transcripts` memory note implies you have an explicit safety story here. Re-port priority: Phase 1 (port the SIGTERM half before cutover) or Phase 2 (accept the regression briefly)?

---

## Appendix A — Quick reference: key v2 files and their lines

| File | Lines of interest |
|---|---|
| `src/session-manager.ts` | 1-18 (cross-mount invariants); 81+ (`resolveSession`); 499+ (outbox cleanup) |
| `src/db/session-db.ts` | 9-18 (invariants); 78-130 (insertMessage / nextEvenSeq); 184-210 (stuck detection); 226 (heartbeat-driven tolerance widening) |
| `src/db/schema.ts` | 1-150 (central schema); 150-225 (INBOUND_SCHEMA); 225-270 (OUTBOUND_SCHEMA) |
| `src/channels/adapter.ts` | 1-100 (ChannelSetup / InboundEvent / OutboundMessage / OutboundFile); 165+ (ChannelAdapter contract); 240+ (ChannelAdapterFactory / ChannelRegistration) |
| `src/channels/channel-registry.ts` | 21-47 (registerChannelAdapter / initChannelAdapters) |
| `src/channels/chat-sdk-bridge.ts` | 367-509 (`deliver` — content type dispatch); 528 (subscribe); 549 (openDM wrapper) |
| `container/agent-runner/src/mcp-tools/core.ts` | 90-130 (resolveRouting); 100+ (sendMessage); 130-190 (sendFile); 195-220 (editMessage); 222-260 (addReaction); 263 (registerTools) |
| `src/db/schema.ts` | tables: `agent_groups`, `messaging_groups`, `messaging_group_agents`, `users`, `user_roles`, `agent_group_members`, `user_dms`, `sessions`, `pending_questions`, `pending_sender_approvals` |
| `src/modules/permissions/index.ts` | 10-50 (module entry); 127-180 (unknown_sender_policy switch) |
| `src/modules/scheduling/db.ts` | full file (insertTask, etc.) |
| `src/host-sweep.ts` | full file (decideStuckAction et al.) |
| `src/circuit-breaker.ts` | full file — note: STARTUP backoff, not per-call provider error |
| `src/providers/claude.ts` | 13-30 (ANTHROPIC_BASE_URL pickup) |
| `setup/migrate-v2/db.ts` | 68 (the `is_main` SELECT — the blocker) |
| `setup/migrate-v2/shared.ts` | JID parsing, trigger mapping, CHANNEL_AUTH_REGISTRY |
| `setup/install-whatsapp.sh` | template for channel install scripts (hardcoded `git fetch origin channels`) |

## Appendix B — Useful upstream commits to read in full

- `9486d56` — "v2: make v2 the main entry point, move v1 to src/v1/" — the cutover.
- `86becf8` — "chore: delete v1 reference code" — final cleanup.
- `2.0.0` CHANGELOG entry — the breaking-changes manifesto.
- `2.0.45` CHANGELOG entry — `migrate-v2.sh` shipped here.
- `2.0.48` CHANGELOG entry — container config moved to DB (relevant to per-group model/effort).
- `2.0.54` CHANGELOG entry — `ncl groups config --model --effort` shipped here.

---

END OF SCOUT REPORT
