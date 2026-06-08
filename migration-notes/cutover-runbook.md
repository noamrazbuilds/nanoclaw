# v1→v2 Cutover Runbook

Living runbook for the final cutover, assembled while working the checklist (2026-06-07). v1 is **offline/frozen** since 2026-06-06; the Path-D "<60s rollback to a live v1" property is moot, but the frozen snapshot is the rollback source.

**Frozen v1 snapshot:** `~/nanoclaw-v1-snapshot-20260607-142631/` — sha256 `031c7b4870e879900043d2baaf3ed10d0328895dd2f1d519c269d4d156ca474a`. Row counts: 13,789 reactions · 19,450 messages · 120 tasks (10 active) · 36 groups · 49 audit · 12/62/41 arena.

---

## Cutover mechanics — the key wrinkle

`~/NanoClaw` (main worktree, branch `main`, the **service target**) and `~/nanoclaw-v2` (linked worktree, branch `v2-migration`, where all the work happened) are **two worktrees of the same repo**. Git won't allow `v2-migration` checked out in two worktrees at once. So the cutover must do **one** of:

- **(A) Merge then checkout** *(recommended)*: `git -C ~/nanoclaw-v2` work is on `v2-migration`; fast-forward `main` to `v2-migration`, then in `~/NanoClaw` `git checkout main` is already current → `git reset --hard <v2-migration sha>`. But `main` checked out in `~/NanoClaw` can't be reset while `v2-migration` is a separate branch — simplest: in `~/NanoClaw`, `git merge --ff-only v2-migration` (fast-forwards `main`). The linked `~/nanoclaw-v2` worktree can stay.
- **(B) Remove the linked worktree first**: `git worktree remove ~/nanoclaw-v2` (task #21), then in `~/NanoClaw` `git checkout v2-migration`.

Decision pending at execution (task #20). (A) keeps the worktree for post-cutover reference; (B) is cleaner end-state. Either way the **service runs from `~/NanoClaw`**, whose `.env`, `store/`, and `data/` are already in place.

---

## `.env` — VERIFIED (task #16)

**The in-place cutover preserves `~/NanoClaw/.env` (the v1 .env, all secrets).** `setup/migrate-v2/env.ts` (`1a-env`) copies any missing v1 keys into v2's `.env` and never overwrites — a no-op safety net when v1Path == cutover dir. v1 `.env` already has: `ARENA_BOT_TOKEN_*` (6), `ARENA_ENABLED`, `CLAUDE_OAUTH_TOKEN`, `DEFAULT_FALLBACK_MODEL`, `DEFAULT_MODEL`, `LITELLM_API_KEY`, `LITELLM_PROXY_URL`, `OAUTH_PROXY_URL`, `ONECLI_URL`, `OPENAI_API_KEY`, `TELEGRAM_*`, `TZ`, `USE_OAUTH`, `WHISPER_MODEL`, `ASSISTANT_NAME`, `IDLE_TIMEOUT`. Every v2-new key has a safe code default. Items to apply / verify:

- **Soft rename — `LITELLM_HOST`**: the container's `core.ts` (F5 generate_image + LiteLLM) reads `LITELLM_HOST`, default `http://host.docker.internal:4000`. v1 used `LITELLM_PROXY_URL` (per arena memory, already `host.docker.internal:4000` for containers). The default already matches → optional to set `LITELLM_HOST` explicitly to v1's `LITELLM_PROXY_URL` value. (Host-side arena uses hardcoded `http://localhost:4000`, unaffected.)
- **Verify (non-blocking, logs will show):**
  - `ONECLI_API_KEY` — v2 reads it; v1 ran with only `ONECLI_URL`. Local OneCLI is likely keyless (matches v1) → leave unset unless 401s appear.
  - `WHISPER_PYTHON` — defaults to `python3`; host needs `python3` + whisper installed for voice transcription (transcription runs host-side; see F3 host deps). `data/whisper-models/` already present.
  - `ANTHROPIC_BASE_URL` — only needed to route through LiteLLM (enables C1 credit-fallback). v1 used `USE_OAUTH=true` (Claude Max OAuth direct), so it may be intentionally unset; C1 fallback stays dormant under OAuth, which is fine.

---

## Pass-B data migration — RESOLVED: nothing to build (task #15)

All four deferred tables consciously **not migrated** (see `data-migration-gaps.md` Pass-B resolution): reactions (per-session, no consumer — user: skip), arena (user: fresh start), task_audit_log (dangling task-id refs post-remap), skills_hash (recomputed by C3). The migration pipeline is exactly Pass-A's steps.

---

## Migration pipeline (Pass-A steps, in order)

Run with v1Path = `~/NanoClaw` (in-place) — reads `store/messages.db`, writes `data/v2.db`:
`1a-env` · `1b-db` · `1c-groups` · `1d-sessions` · `1e-tasks` · `1f-container-configs` · `2b-channel-auth`.
(End-to-end harness: `scripts/test-data-migration.sh` — last run 8/8 PASS against production.)

---

## Post-migration per-group config (apply after `1*` steps populate `v2.db`; assets VERIFIED in place)

All target the **owner agent group** (find its id: `ncl groups list`). Assets confirmed present on the host for the in-place cutover — nothing to stage.

**F2 — AnyList (task #18).** Vendor ready at `~/NanoClaw/vendor/anylist-mcp` (has `node_modules` + `run.sh`; in-place cutover keeps it).
```
ncl groups config update --id <owner> \
  --add-mount '{"hostPath":"/home/nanoclaw/NanoClaw/vendor/anylist-mcp","containerPath":"/workspace/project/vendor/anylist-mcp","readonly":true}' \
  --add-mcp-server 'anylist={"command":"bash","args":["/workspace/project/vendor/anylist-mcp/run.sh"],"env":{}}'
# ANYLIST_EMAIL / ANYLIST_PASSWORD → OneCLI vault (v1 had them in ~/NanoClaw/.env.local). Smoke: get_lists.
```

**F3 — link-to-audio (task #17).** Skill in-tree; ambient source at `~/.ambient-audio/` (only `rain.wav` present — other ambiences synthesize brown noise, matching v1). Host needs `python3`+whisper for U1 voice (separate from the container pip deps).
```
ncl groups config update --id <owner> \
  --add-skill link-to-audio \
  --add-apt ffmpeg --add-apt python3 --add-apt python3-pip \
  --add-pip openai --add-pip newspaper3k --add-pip readability-lxml \
  --add-mount '{"hostPath":"/home/nanoclaw/.ambient-audio","containerPath":"/ambient-audio","readonly":true}'
# OPENAI_API_KEY already in v1 .env. Then: ncl groups restart --id <owner> --rebuild  (lands apt+pip). Smoke: !listen <url>
```
> NOTE: verify the exact `ncl groups config update` flag names against `ncl groups config help` at cutover — the add-mount/add-mcp-server/add-skill/add-apt/add-pip surface may differ; fall back to `config get` → edit JSON → `config update` if needed.

**C4/C6 — task-data edits (task #19).** Post-migration edits to the migrated scheduled-task rows in `v2.db` (v1 tasks → `messages_in` / scheduling tables). Identify the daily-update + concert tasks (`ncl` or `scripts/q.ts data/v2.db "SELECT ..."`):
- **C4 part-4:** clamp the daily-update task's prompt to a 48h look-back window (prompt-text edit).
- **C6:** add `required_tools` to the concert task's content (canary for honest-failure enforcement; lenient if undeclared, so this is opt-in hardening).

## Cutover + cleanup (tasks #20, #21)

- [ ] #20 Execute cutover (mechanics above) + Pass-A migration + apply F2/F3/C4/C6 config + start + per-channel smoke — **NEEDS EXPLICIT GO** (goes live on real WhatsApp/Telegram).
- [ ] #21 Remove stale `porter-*` worktrees (or fold into cutover mechanics option B).

## OneCLI selective-secret-mode standby (CLAUDE.md gotcha — VERIFY ON FIRST SPAWN)

All container API calls route through the OneCLI gateway (`applyContainerConfig` injects HTTPS_PROXY + CA; spawn hard-fails without it). `agentIdentifier = agentGroup.id` (`src/container-runner.ts:138`). On first spawn, `ensureAgent` creates a **new** OneCLI agent (identifier = `ag-…`) in **`selective` mode → no secrets injected**. Vault currently holds only the **Anthropic** secret (`api.anthropic.com`). v1 ran `USE_OAUTH=true` (Claude Max OAuth via `CLAUDE_OAUTH_TOKEN`, refreshed by U4), so the container *may* authenticate via OAuth and not need the vault key — **unknown until the first live spawn.** Cannot pre-empt: `set-secret-mode --id` needs the agent UUID, which doesn't exist until the agent registers on first spawn.

**Standby procedure (the moment the first container spawns):**
```bash
onecli agents list                       # find the new ag-… agent's UUID + secretMode
# If Claude calls 401 / auth-fail AND the agent is selective:
onecli agents set-secret-mode --id <uuid> --mode all   # gateway looks up per-request; next call works, no restart
```
The Default Agent is already `mode all`; v1's per-folder agents (`whatsapp-anthony-belfiore`, …) are stale (v2 uses `ag-…` identifiers, won't reuse them). Likely want every active v2 agent on `mode all` once they register.

## Post-cutover smoke matrix

WhatsApp: text · image · sticker · voice · reaction. Telegram: voice. Scheduled task: verify next-run lands. Tail `logs/nanoclaw.error.log` ~30 min. **First spawn:** watch for the OneCLI selective-mode 401 above.

## POST-CUTOVER STATE (2026-06-08, after live smoke)

v2 is LIVE (service → `~/nanoclaw-v2`). Pipeline verified end-to-end on WhatsApp + Telegram. Issues found on first real run and **fixed live**:
- **Container image was never built** in the worktree → built `nanoclaw-agent-v2-1e478a5f:latest` (exit 125/127 before).
- **v1 transcript resume crash** (API 400 on bad tool_use.id) → cleared all migrated `continuation:*` rows; sessions start fresh (workspace memory intact).
- **WhatsApp auth-wipe on clean shutdown** (deleted keystore every restart) → fixed close-handler; restored keystore from `~/NanoClaw/store/auth`.
- **Cold-DM owner-spam on shared number** (every contact DM escalated to owner) → DMs engage only for owner self-chat (or dedicated-number installs); purged 10 stray cold-DM groups.
- **Lost attachments** (saved to unmounted `data/attachments`) → now base64-staged into session inbox (canonical v2 shape); the bug affected your legal PDFs.
- **Path drift** `/workspace/group`→`/workspace/agent` → rewrote 42 group files + 3 skills + migrated task prompts.
- **Ambient monitoring was OFF** (all wirings `drop`) → set `accumulate` on all 36 (forward coverage).
- **No searchable history** → built `data/archive.db` (FTS5, 19,450 msgs), mounted read-only into owner groups + documented search in their CLAUDE.local.md.
- **No python3 in base image** → added python3/venv/pip (rebuilt image).

⚠️ **WhatsApp adapter fixes (auth-wipe, cold-DM, attachment) are working-tree-only** — must be pushed to `origin/channels` or a reinstall loses them. (task #26)

### Remaining capability PORTS (scheduled tasks fail until these land; user chose to leave tasks running)
1. **GWS/Gmail integration** — v2 vault has only the Anthropic secret; no Google creds, no Gmail/Drive/Sheets tooling. v1's `gws`-CLI MCP integration ([[project_gws_integration]]) isn't ported. Blocks: Morning Triage, Daily Update, Concert. Needs Google OAuth (user) + gws CLI in container + MCP wiring.
2. **Central message store** — v2 has no aggregate message DB (v1 had `messages.db`). `accumulate` writes per-session (36 scattered inbound.dbs); `archive.db` is frozen history. Triage/daily-update "scan recent unread across all chats" needs a central live store or a cross-session aggregator.
3. **PKA venv** — base image now has python3.11, but the host venv was built for 3.12 → packages won't load in-container. Needs venv rebuilt for the container python (or PKA restructured to `packages_pip`). Plus session-review subagent can't see `/workspace/extra/pka` (Task-tool cwd/additionalDirectories — run review in main context).

### Other deferred (config/decision)
- F2 AnyList: vendor ready (`~/NanoClaw/vendor/anylist-mcp`), owner `mcp_servers={}`; needs wiring + creds location.
- F3 link-to-audio: not enabled; `link2audio.py` still has v1 `/workspace/ipc` delivery paths.
- C4 daily-update 48h clamp (depends on daily-update working first); C6 concert `required_tools`.
- Remove stale `porter-*` worktrees.
- All 3 owner OneCLI agents are `selective` mode — flip to `all` (or assign secrets) once Google creds are in the vault.

## Rollback

Stop service; restore `store/messages.db` from the frozen snapshot; `git -C ~/NanoClaw checkout main@{pre-cutover}` (or the recorded pre-cutover sha); restart. v1 binary still on disk.
