# Phase 1 Prep — v1→v2 Migration

Generated 2026-05-14 after gauntlet + Scout reconnaissance. This document is the operational playbook for kicking off Phase 1 of the parallel-track v2 cutover. **Nothing in here has been executed yet.**

Source-of-truth references:
- Strategic plan: `gauntlet-logs/gauntlet-2026-05-14-162241.md`
- Reconnaissance: `migration-notes/v2-scout-report.md`
- Memory: `~/.claude/projects/-home-nanoclaw-NanoClaw/memory/project_nanoclaw_v2_upgrade.md`

---

## Decisions locked

1. **`is_main` blocker → MOOT** (verified 2026-05-15). Scout misread the static `CREATE TABLE` block and missed the runtime `ALTER TABLE` from fork commit `0210aa9` (multi-channel refactor). Production DB has the column correctly populated (`whatsapp_main` + `telegram_main` flagged). No patch applied; step 1.5 reduces to a plain DB copy.
2. **Translate vs re-implement → spec-first hybrid.** Extract behavioral specs, stash v1 source to `docs/v1-fork-reference/`, re-implement against v2 idioms. Confirmed exception: `oauth-refresh.ts` (Verifier 2026-05-15 — OneCLI does NOT cover it; stash-and-copy-back the v1 daemon).
3. **Inbound sticker parity → KEEP**, port to fork of `nanoclaw-whatsapp` channel skill. 30-min addition to v2's `downloadInboundMedia`. No v2 core changes.

---

## Phase 1 operations (ordered, with rationale)

Each step lists: action, rationale, reversibility, and (where relevant) the literal command. None of these run yet — wait for explicit go-ahead.

### 1.1 — Snapshot tag on production `main`

```bash
git checkout main
git tag -a v1-production-snapshot-$(date -I) -m "Pre-v2-migration snapshot — last known-good v1 state."
git push origin v1-production-snapshot-2026-05-14
```

**Rationale:** Instant rollback target. Production service keeps running on `main`; this tag is the "land here if cutover fails" reference.
**Reversibility:** `git tag -d <name>` locally + `git push --delete origin <name>` remotely. Trivial.

### 1.2 — Create migration worktree

```bash
git fetch upstream
git worktree add -b v2-migration ../nanoclaw-v2 upstream/main
cd ../nanoclaw-v2
```

**Rationale:** `git worktree` lets us check out `upstream/main` in a sibling directory without touching the production checkout. Production service keeps running from `~/nanoclaw` on the `main` branch. Migration work happens in `~/nanoclaw-v2` on the `v2-migration` branch. They share `.git/` (history, refs, packfiles) but their working trees are independent.
**Reversibility:** `git worktree remove ../nanoclaw-v2 && git branch -D v2-migration`. Nothing in production touched.

### 1.3 — Verify the worktree builds clean upstream

```bash
cd ../nanoclaw-v2
pnpm install --frozen-lockfile   # upstream uses pnpm, not npm
pnpm run build
pnpm test
```

**Rationale:** Establish baseline before introducing any customizations. If upstream's tip doesn't build in your environment (Node version, native modules, etc.), discover that NOW, not after porting work has been mixed in.
**Reversibility:** Nothing to undo — purely a check.

### 1.4 — Stash v1 source to `docs/v1-fork-reference/`

```bash
# From within the worktree (~/nanoclaw-v2)
mkdir -p docs/v1-fork-reference/src
# Pull v1 versions of the preserved customization files into the reference dir
for f in src/arena src/oauth-refresh.ts src/host-ops.ts src/slots.ts src/text-styles.ts \
         src/transcription.ts src/whatsapp-auth.ts src/status-tracker.ts src/image.ts \
         src/channels/whatsapp.ts src/channels/telegram.ts; do
  mkdir -p "docs/v1-fork-reference/$(dirname "$f")"
  git show origin/main:$f > "docs/v1-fork-reference/$f" 2>/dev/null || \
    git show origin/main:$f > /dev/null  # silent failure on directories
done
# For directories like src/arena, do a full copy
git archive origin/main src/arena | tar -x -C docs/v1-fork-reference/
echo "Stashed v1 source — DO NOT translate, this is READ-ONLY REFERENCE." > docs/v1-fork-reference/README.md
git add docs/v1-fork-reference/
git commit -m "chore: stash v1 fork customizations as read-only reference"
```

**Rationale:** Upstream's `/migrate-from-v1` skill says explicitly: *"Source code (`src/*`, `container/agent-runner/src/*`) is NOT portable — stash to `docs/v1-fork-reference/` with a README explaining what each file did. Don't translate."* Porter agents read these as reference, not as source-of-truth for translation.
**Reversibility:** `git reset HEAD~1 && rm -rf docs/v1-fork-reference/`. Worktree-local.

### 1.5 — Copy the v1 DB into the worktree

```bash
# Copy production DB into the worktree (read-write copy, never touches prod)
cp /home/nanoclaw/NanoClaw/store/messages.db /home/nanoclaw/nanoclaw-v2/v1-messages-copy.db
# Verify is_main is already populated (set by fork commit 0210aa9's runtime ALTER TABLE)
sqlite3 -header -column /home/nanoclaw/nanoclaw-v2/v1-messages-copy.db \
  "SELECT folder, name, is_main FROM registered_groups WHERE is_main=1;"
# Expect: whatsapp_main + telegram_main, both is_main=1
```

**Rationale:** v1-messages-copy.db becomes the input to a *dry-run* migration in Phase 3 (`migrate-v2.sh` reads from it without writing back). Production DB remains untouched. The `is_main` patch originally planned here is no longer needed — see "Decisions locked" §1 above for why the blocker doesn't exist on this fork.
**Reversibility:** Delete the copy: `rm /home/nanoclaw/nanoclaw-v2/v1-messages-copy.db`.
**Gitignore note:** the v2-migration branch's `.gitignore` was updated in commit `48abc8f` to ignore `v1-messages-copy.db`, `v1-*.backup`, and `migration-notes/scratch/` — the DB copy will never be committed by accident.

### 1.6 — Fork the channel skill repos (manual on GitHub)

This is a one-time UI step on GitHub.com:

1. Visit `https://github.com/qwibitai/nanoclaw-whatsapp` → Fork → choose `noamrazbuilds`
2. Visit `https://github.com/qwibitai/nanoclaw-telegram` → Fork → choose `noamrazbuilds`

Then locally:

```bash
cd ~/nanoclaw-v2
# Add remotes for the channel forks (you already have them at ~/nanoclaw — re-add in worktree)
git remote add whatsapp-fork git@github.com:noamrazbuilds/nanoclaw-whatsapp.git
git remote add telegram-fork git@github.com:noamrazbuilds/nanoclaw-telegram.git
git fetch whatsapp-fork
git fetch telegram-fork
```

**Rationale:** Porter-Channels will apply the sticker patch + voice transcription wiring + reaction handling to these forks, not to the upstream channel skill repos.
**Reversibility:** Delete the GitHub forks via repo settings; remove local remotes via `git remote remove`.

### 1.7 — Pre-build the work queue (next section)

No git ops — just review and lock the work queue below before spawning Porters.

---

## Spec-extraction template

For each preserved customization, write **one short markdown file** under `migration-notes/specs/<porter>/<customization>.md` using this template:

```markdown
# <Customization name>

## Source (v1)
- Primary file(s): `src/foo.ts`, `src/bar.ts`
- Commit(s): `abc123` (introduced), `def456` (revised)
- Touched by hotfix? Yes/No — link

## Behavioral spec (one paragraph)
When <trigger>, the system <does X> so that <user-visible effect Y>. <Edge cases / failure modes / retries> handled by <mechanism>. The reason this exists is <root cause / incident / requirement>.

## v2 hook point(s)
- File: `src/modules/scheduling/index.ts` (or wherever)
- Function/extension point: `onAgentResult` callback / `taskRunner.beforeDispatch` hook / new module
- Why this hook: <quote from Scout report or upstream code>

## v2-native equivalent that might suffice?
EXISTS-NATIVELY / PARTIAL-OVERLAP / DOES-NOT-EXIST
- If PARTIAL or EXISTS: what does v2 do, and what's missing from a parity standpoint?
- If DOES-NOT-EXIST: confirmed via Scout §5 grep results: <quote>

## Open questions
- <Anything the spec author couldn't decide without a human call>
```

Keep each spec under ~30 lines. Specs are read by Porter agents; brevity beats completeness.

**Spec extraction is its own pre-Phase work** — done before Porters spawn. One spec per customization, ~30 min each. Total: ~12 specs × 30 min ≈ 6 hours, single human pass with Builder agent assist for the grep work.

---

## Customization work queue (Porter ownership + Scout-corrected sequencing)

> **🔒 QUEUE LOCKED — 2026-05-19 (re-locked after U2 clarification + F6 deeper audit).** Three Verifier passes (Scout, Verifier-1, Verifier-2) + upstream channel-skill parity audit 2026-05-19 (two passes — second pass during U1/U2 spec extraction). 20 rows (U3 conditionally DROPPED; F6 reduces to skill-merge-only — see row notes). From this point: Porter agents draw scope from this queue and the documented hook points. Any further changes require explicit unlock + delta record below.

> **Delta log:**
> - **2026-05-18 (unlock 1):** Added **C6** (scheduled-task honest-failure enforcement) after discovering the concert task had been fabricating "244 events, 41 emails trashed" success summaries since ~May 4 with zero corresponding GWS audit entries. Production evidence: `groups/telegram_main/logs/gws-audit.jsonl` — last real concert-task tool call was 2026-05-07T14:24Z; the May 8–18 runs reported success but invoked zero tools. Re-locked same day.
> - **2026-05-19 (unlock 2):** Revised **U1**, **F6**, **U3** after fetching upstream channel-skill remotes (`whatsapp-fork`, `telegram-fork`) and parity-checking against fork. `whatsapp/skill/voice-transcription` + `.claude/skills/use-local-whisper` cover ~85% of U1. `whatsapp/skill/reactions` covers ~75% of F6 AND ships a byte-identical `status-tracker.ts` (so U3 → DROP). Estimated effort reduction ~1–2 Porter-days. Each revised row carries an explicit **"Confirm at spec extraction"** clause — if Porter audit finds the parity claim wrong, row reverts to pre-revision scope. Re-locked same day.
> - **2026-05-19 (unlock 3):** During U2 spec extraction, parity audit found `whatsapp/skill/image-vision` ships a **byte-identical** `image.ts` for the image half — clarified **U2** row to make the skill-merge prerequisite explicit (was implicit before). Separately, during F6 spec extraction, the "Confirm at spec extraction" clause from unlock 2 caught a previous error: **v1 never had a Telegram reaction listener**, so F6's "telegram.ts listener delta" was a phantom. F6 now reduces to skill-merge-only (no fork delta). Re-locked same day.

### Phase 1a — SEQUENTIAL (blocking everything else)

| ID | Customization | v1 source | v2 hook | Notes |
|---|---|---|---|---|
| U1 | `transcription.ts` | `src/transcription.ts` | Apply `whatsapp/skill/voice-transcription` (OpenAI Whisper path) + apply `.claude/skills/use-local-whisper` skill with Linux backend swap + extract channel-agnostic `transcribeAudioBuffer(buffer)` helper (~10 LOC) | **Blocks channels.** Scope-reduced 2026-05-19: upstream's OpenAI path is feature-equivalent (identical fallback string, `whisper-1` model, `response_format: 'text'`, `isVoiceMessage` check). Local-whisper upstream skill uses `whisper-cli` binary (macOS-Homebrew-oriented) — Linux host needs `whisper.cpp` from source OR keep v1's faster-whisper Python script (`scripts/whisper_transcribe.py`). v1's generic `transcribeAudioBuffer(buffer)` helper is channel-agnostic; upstream's is WhatsApp-bound — extract for cross-channel reuse. **Confirm at spec extraction.** |
| U2 | `image.ts` (incl. inbound sticker handler) | `src/image.ts` + `src/channels/whatsapp.ts:333-346` | Apply `whatsapp/skill/image-vision` (byte-identical image half) + add sticker delta (~35 LOC) in the fork of `nanoclaw-whatsapp` | **Blocks channels.** Clarified 2026-05-19: image-vision skill is the prerequisite (byte-identical to v1's image.ts for the image processing). Decision 3 (locked 2026-05-14) — sticker port is the remaining 30 min of work. |

### Phase 1b — PARALLEL

| ID | Customization | v1 source | Owner | v2 hook | Notes |
|---|---|---|---|---|---|
| C1 | Credit-error fallback + LiteLLM fallback chain | `src/index.ts` (`runAgent`), `src/task-scheduler.ts` (post-hotfix `8d42685`) | Porter-Core | `src/session-manager.ts` + `src/modules/scheduling/` | Re-implement, do not translate. Scout §5 confirmed v2 has no native equivalent. |
| C2 | Sonnet grader (cost reduction) | varies | Porter-Core | adapt to v2's per-group model overrides | v2 has `ad5d4d2` per-group model + effort overrides — leverage it. |
| C3 | Agent drift safeguards (24h rotation + skill-hash invalidation) | session lifecycle hooks | Porter-Core | `src/session-manager.ts` | Scout §5: v2 lacks explicit equivalents. Security controls — port don't replace. |
| C4 | Daily-update pipeline hardening (suppress chat output, block self-mod, audit trail, window cap) | scheduled-task wrapper + daily-update task prompt | Porter-Core | `src/modules/scheduling/` + custom `setup/migrate-v2/tasks.ts` | **Four-part — all must land together:** (1) extend the migration's content-JSON payload in `setup/migrate-v2/tasks.ts` to preserve `model` + `suppress_chat_output` from v1 `scheduled_tasks` (Verifier-confirmed silent data loss otherwise); (2) v2 scheduling-executor change to honor those fields at runtime — without it, (1) is preservation-without-function; (3) **transitive suppression** — `suppress_chat_output` must apply to ALL delegated subagent outputs (Task tool fan-out, sub-Task chains), not just the main agent's `send_message` calls. Production bug observed 2026-05-15: subagent intermediate dumps (Israeli News, NYT, CNN, BBC) leaked to Telegram despite the flag being set. Likely v1 only filtered the top-level agent's chat ops; v2 must filter the entire delivery surface from any agent in the task's tree; (4) **window-age cap** — when reading `last_update_sent_at` from the daily-update config, clamp it to no older than 48h before computing the digest window. Production bug observed 2026-05-15: after a 14-day broken streak (May 1–14 credit-fallback issue), the first successful run inherited an April-30 anchor and produced a 15-day catch-up digest. Implement as either (a) a hard clamp at the prompt level (read in task prompt logic) or (b) a generic scheduling-config "stale anchor" guard that applies to any task using a watermark file. (a) is faster, (b) is right long-term. |
| CH1 | WhatsApp channel skill (sticker handling already in U2) | `src/channels/whatsapp.ts` | Porter-Channels | fork of `nanoclaw-whatsapp` | Rebase on `upstream/channels`'s WhatsApp skill, apply diffs from `docs/v1-fork-reference/`. |
| CH2 | Telegram channel skill | `src/channels/telegram.ts` | Porter-Channels | fork of `nanoclaw-telegram` | Same pattern as CH1. |
| CH3 | `whatsapp-auth.ts` clash resolution | `src/whatsapp-auth.ts` vs `setup/whatsapp-auth.ts` upstream | Porter-Channels | merge into upstream's `setup/` location | Compare both, take the better one. |
| F1 | Model Arena (5-bot Telegram showdown) | `src/arena/*` (11 files) | Porter-Features | `src/modules/arena/` + separate `arena.db` OR v2 central DB with migrations | Scout §8.3: Arena writes directly to fork's `messages.db`; that function disappears in v2. Re-host DB. Keep `grammy` directly. |
| F2 | AnyList MCP integration | wiring + credentials | Porter-Features | `container_configs.mcp_servers` JSON column (`src/container-config.ts:34`) | Verifier-2 2026-05-18: v2 replaced `.mcp.json` mount with DB-driven `container_configs.mcp_servers`. Rewire AnyList MCP registration via this column. Source must be available **inside the container** — bundled in image or mounted via `container_configs.additional_mounts`. Reference memory `anylist_mcp_setup` needs updating after lock. |
| F3 | Link-to-audio background mixing | container skill `container/skills/link-to-audio/` | Porter-Features | `container/skills/link-to-audio/` + register via `container_configs.skills` | Verifier-2 2026-05-18: skill does NOT exist in upstream — full copy required. Per-group skill selection via `container_configs.skills`. |
| F4 | OneCLI CA cert auto-extract (`scripts/backup-memory.sh` cert block only) | `scripts/backup-memory.sh` | Porter-Features | scripts/ folder in v2 | Verifier-2 2026-05-18: NARROWED. v2's container-runner + build.sh handle CA cert mount + bake-in natively (SDK-internal); the fork's value-add is the **backup script's cert-extract block** that preserves the cert across host rebuilds. Port only that block, not the broader cert infra. |
| F5 | Custom agent tools surface (`register_group`, `host_op`, `pause_task`, `resume_task`, `cancel_task`, `generate_image`; `react_to_message` MOVED to F6) | `container/agent-runner/src/ipc-mcp-stdio.ts` | Porter-Features | `container/agent-runner/src/mcp-tools/core.ts` | Per-tool decision per Scout §3. Recommended: 10-min production-log audit to identify which tools actually fire vs dead code, then per-tool keep/drop. |
| F6 | **Inbound reactions** (NEW — Verifier-2 2026-05-18, scope-reduced 2x: 2026-05-19) | WhatsApp listener in `src/channels/whatsapp.ts:408-446`; storage in `src/db.ts` (`reactions` table); `react_to_message` MCP tool in `container/agent-runner/src/ipc-mcp-stdio.ts:71-86` | Porter-Features | Apply `whatsapp/skill/reactions` — full coverage; no fork delta | **Skill-merge only.** Reduced 2026-05-19 (unlock 3): the "Confirm at spec extraction" clause from unlock 2 caught a previous error — v1 never had a Telegram reaction listener (only WhatsApp; Telegram's only reaction-adjacent code is sticker emoji extraction into `[Sticker ${emoji}]` content). So the "<50 LOC Telegram delta" from unlock 2 was a phantom. Upstream skill is **byte-identical** to v1 across listener, reactions table (composite PK on `message_id+chat_jid+reactor_jid`, 4 indexes), `storeReaction` writer, `sendReaction` outbound, and `react_to_message` MCP tool. Also bundles status-tracker.ts (confirms U3 → DROP). Porter task: `git merge whatsapp/skill/reactions`, run `npx tsx scripts/migrate-reactions.ts`, validate. |
| C5 | **Scheduled-task audit log** (NEW — Verifier-2 2026-05-18) | `task_audit_log` table in fork's `src/db.ts` + every mutation site in `src/db.ts` / `src/task-scheduler.ts` | Porter-Core | new migration in `src/db/migrations/` + audit-insert hook in `src/modules/scheduling/db.ts` | v2 has NO equivalent audit table. C4 (daily-update hardening) relies on this for its audit trail; without C5, C4's audit-trail bullet is unfulfillable. Sequence: C5 lands before C4's audit work within Porter-Core. |
| C6 | **Scheduled-task honest-failure enforcement** (NEW — production evidence 2026-05-18) | new (does not exist in v1) | Porter-Core | scheduler executor in `src/modules/scheduling/` — observes the run's tool-call ledger before accepting "success" | **The fabrication problem.** Concert task (`task-1774571091832-vw79ss`) reported "244 events, 41 emails trashed" on May 17 with **zero** GWS audit entries; same pattern May 8–17. Agent fabricated success summaries from compacted-history numbers when actual tool calls failed silently. Fix at the system level, not the prompt level: scheduler inspects the run's tool-call ledger (count, types, status) and overrides "success" → "error" when the required tool surface wasn't actually touched. Per-task "required tool signatures" declared on the task (e.g., concert task requires ≥1 successful `sheets.values.get` + ≥1 `sheets.values.clear/update`). Without this, prompt-level retries can't catch the failure mode because the agent's own report is the only signal. Depends on **C5** (audit-log infrastructure) for the tool-call ledger. |

**Footnote — C4 spec-extraction pointers (added 2026-05-15):**
1. The daily-update task **prompt** lives in the v1 DB at `scheduled_tasks.prompt` for `id='task-1774572694013-gejcab'`, not in any source file. Spec extraction must read it from `v1-messages-copy.db` in the worktree (or the production DB read-only). The four-part C4 work depends on understanding both the prompt's window-start logic (`last_update_sent_at`) and the inline subagent dispatch instructions (`Task(subagent_type='haiku-agent', ...)`).
2. v2's **Task-tool fan-out / subagent output flow** is not fully mapped in `v2-scout-report.md`. Before designing C4 part (3) [transitive suppression], Porter-Core should grep `upstream/main` for `subagent_type`, `Task(`, agent-to-agent message routing, and verify where subagent results enter the outbound delivery surface — that's where transitive suppression must be enforced. A quick second Verifier pass is acceptable substitute if it surfaces concrete answers fast.

### Phase 1c — SEQUENTIAL (after 1b)

| ID | Customization | v1 source | v2 hook | Notes |
|---|---|---|---|---|
| U3 | `status-tracker.ts` | `src/status-tracker.ts` | Bundled into F6 skill merge (`whatsapp/skill/reactions`) — no separate work | **DROP** (2026-05-19: byte-identical implementation ships inside `whatsapp/skill/reactions` — same enum `StatusState{RECEIVED, THINKING, WORKING, DONE, FAILED}`, same constants `CLEANUP_DELAY_MS=5000` / `RECEIVED_GRACE_MS=30_000` / `REACTION_MAX_RETRIES=3` / `REACTION_BASE_DELAY_MS=2000`, same persistence path `data/status-tracker.json`, same emoji sequence 👀→💭→🔄→✅/❌, same heartbeat logic with grace period). Picked up at zero additional cost when F6 lands. **Confirm at spec extraction** — if upstream version diverges, or imports (`DATA_DIR`, `CONTAINER_TIMEOUT`, `logger`) don't resolve against v2's module layout, this row reverts to "PORT" status per Verifier-2 2026-05-18 reasoning (heartbeat=liveness ≠ per-message UX). |
| U4 | `oauth-refresh.ts` (SOCKS5/Cloudflare workaround) | `src/oauth-refresh.ts` | host-side daemon, started in `src/index.ts` startup hook | **PORT** (Verifier-1 2026-05-15). OneCLI is a container-side HTTPS proxy that injects creds; it does NOT auto-refresh Claude Max OAuth and does NOT route host-side requests. v2's native fallback says "Re-run `claude setup-token` manually on 401" — the fork's daemon avoids this manual loop. Deps: `socks-proxy-agent` npm package + `OAUTH_PROXY_URL` env var (SOCKS5 to Synology). Stash-and-copy-back (the spec-first exception per Decision 2). |
| U5a | `slots.ts` | `src/slots.ts` | (unbundled) | Likely import-path fixes only; minimal logic. |
| U5b | `text-styles.ts` | `src/text-styles.ts` | likely **REPLACE** with v2's `upstream/skill/channel-formatting` | Unbundled from U5: v2 has a dedicated channel-formatting skill; verify overlap at spec extraction, prefer v2 native. |
| U5c | `host-ops.ts` | `src/host-ops.ts` | (unbundled) | Likely import-path fixes only; minimal logic. |
| U6 | **SIGTERM markdown-archive handler** (NEW — Verifier-2 2026-05-18) | `container/agent-runner/src/index.ts` SIGTERM handler + `PreCompact` archive function | container/agent-runner equivalent in v2 | Verifier-2 2026-05-18: v2's per-turn DB + SDK `.jsonl` are continuous (crash-safe), so the broad "crash-safe transcripts" concern from `project_crash_safe_transcripts` is mostly handled natively. ONLY the markdown-format archive on SIGTERM is fork-only. ~30 LOC port; reuse existing `PreCompact` function. |

### Out of Phase 1 (deferred / dropped)

- **`8d42685` BLOB→TEXT prompt coercion**: DROP (Verifier-confirmed 2026-05-15). v2's schema makes the Buffer-binding bug structurally impossible — distinct table/column types and explicit binding sites. No port needed.
- **Outbound stickers**: never existed — non-issue.
- **In-tree `src/channels/whatsapp.ts` + `telegram.ts` test files**: DROP. Re-write tests against skill-branch versions during CH1/CH2.

---

## Pre-flight checklist before kicking off Phase 1.1

- [ ] All three decisions locked in memory ✅ (done 2026-05-14)
- [ ] Scout report read end-to-end ✅
- [ ] User confirms they have an uninterrupted ~30 min window for Phase 1.1–1.3 (snapshot tag + worktree + clean build)
- [ ] User confirms GitHub forks for `nanoclaw-whatsapp` and `nanoclaw-telegram` will be created when Phase 1.6 runs
- [ ] Production service health check: `systemctl --user status nanoclaw` shows green; no in-flight scheduled tasks that would crash on a v1 restart
- [ ] Disk space check: worktree + DB copy will cost ~500 MB; `df -h ~` shows >2 GB free
- [ ] No active migration session running in another window

---

## What happens after Phase 1 prep

Once these prep steps are executed, **Phase 2 (spec extraction + Porter execution)** begins:

1. Spec extraction pass: ~6 hours, one human session with Builder agent assist. Output: ~12 spec files under `migration-notes/specs/`.
2. Porter spawn:
   - **U1 + U2 first** (sequential, blocking).
   - Then **C*, CH*, F*** Porters in parallel.
   - Then **U3-U5** sequentially.
3. Validation pass: `pnpm build && pnpm test`; dry-run `migrate-v2.sh` against `v1-messages-copy.db`.
4. Acceptance testing matrix (12 tests from gauntlet plan §3 Phase 3).
5. Cutover (Phase 4 — human only).

Total estimated wall time from prep through cutover: 30-45 hours over 4-6 focused days.
