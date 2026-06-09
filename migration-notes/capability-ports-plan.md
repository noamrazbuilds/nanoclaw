# Scheduled-task capability ports — plan (2026-06-08)

> **✅ ALL THREE CAPABILITIES DONE + VERIFIED (2026-06-08).** (B) central message store — `src/message-archive.ts` host-archiver into `data/archive.db`, verified live (real traffic). (C) PKA — python3 in base image + task-path fixes + run-in-main-context, verified in-container. (A) GWS — Option B host-proxy (`src/gws-proxy.ts` + container `gws-mcp-stdio.ts` + `google-workspace` skill), verified end-to-end container→proxy→gws→Gmail; required UFW `allow in on docker0 to any port 7850` (applied). Remaining = config/ops only: daily_update `config.json` init (needs delivery prefs), push WhatsApp adapter fixes to origin/channels, C4/C6 task tweaks, worktree cleanup, PKA embeddings venv (non-scheduled-task).

Deliberate next phase after cutover: trace every migrated scheduled task to its v2
dependencies, then port the missing capabilities. Phase A (this matrix) → Phase B
(design, gauntlet the consequential ones) → Phase C (implement + verify).

## Phase A — task → dependency matrix (all 10 active tasks, owner telegram_main session)

| # | Task | cron (TZ) | Capabilities needed |
|---|------|-----------|---------------------|
| 1,4 | PKA inbox review | 13:00 / 05:00 | **PKA**: `python3 /home/nanoclaw/pka/scripts/inbox_classify.py` — ⚠️ HOST path, wrong in container (should be `/workspace/extra/pka/scripts/`); python3 (✓ added) + script deps |
| 2 | PKA weekly review | Sat 17:00 | **PKA**: `task_query.py`, `inbox_classify.py`; send_message |
| 3 | PKA memory consolidation | 05:00 | **PKA**: dispatch `memory-consolidation` Task **subagent**; subagent must read `/workspace/extra/pka/.claude/agents/*.md` + files; python3/deps |
| 5 | PKA morning briefing | 06:00 | **PKA** (file-only): read/write `/workspace/extra/pka/HEARTBEAT.md` + `pipeline/sessions/*.json`; send_message. No python/Gmail — should work once mount is readable |
| 9 | PKA session review | 05:45 | **PKA**: dispatch `session-review` Task **subagent** + mount access + python3/deps |
| 6 | Morning triage | 07:16 | **GWS/Gmail** (unread email 12h) + **central message store** (WhatsApp unread) + send_message |
| 7 | Concert sheet | 17:23 | **GWS**: Gmail search/read/**trash** + **Sheets** read/clear/write (`gws_run`) |
| 8 | Daily update | 06:31 | **GWS** (`gws_run` ×3: quote Sheet; Gmail) + **subagent model delegation** (haiku/sonnet agents — C4 `allow_model_delegation`) + `/workspace/agent/daily_update/{config,quote_recent,current_state,last_run}.json` (need init) |
| 10 | USD/ILS tracker | 16:05 | python3 stdlib urllib (✓ works) + **GWS** (`gws_run` Sheets append) + send_message |

## The three capabilities (by reach)

### A. GWS — `gws_run` (Google Workspace: Gmail + Sheets + Drive)  →  tasks 6, 7, 8, 10
Most-used. v1 invoked a `gws` CLI (see [[project_gws_integration]], [[reference_gws_cli_direct_invocation]], [[reference_gws_auth_headless]]). v2 has **no Google creds** (vault = Anthropic only) and **no gws tooling**. Port = gws CLI in container + Google OAuth in OneCLI vault + expose as `gws_run` (MCP tool or Bash). **Needs user: Google OAuth.**

### B. Central message store  →  tasks 6 (triage), 8 (partial)
v2 has no aggregate message DB. `accumulate` (now on) writes per-session across 36 inbound.dbs; `archive.db` is frozen history. Triage needs "recent unread across all chats." **Design decision — gauntlet this.** Options: (a) host-side archiver that mirrors every inbound message into a central live `archive.db` table; (b) cross-session aggregator the agent queries; (c) MCP tool `search_messages` over a central store.

### C. PKA runtime  →  tasks 1,2,3,4,5,9
python3 added (✓) but: (i) host venv built for 3.12 won't load under container 3.11 → rebuild venv for container OR `packages_pip`; (ii) task prompts use HOST path `/home/nanoclaw/pka/...` not container `/workspace/extra/pka/...`; (iii) Task **subagents** can't see the mount (additionalDirectories not inherited) — run PKA agents in main context or extend subagent dir access; (iv) PKA scripts need their python deps.

### (D) Subagent model delegation  →  task 8
C4 `allow_model_delegation` already implemented; verify haiku/sonnet delegation works in v2 + the daily_update config files exist.

## Phase B — design (gauntlet the consequential)
1. **Central message store architecture** → /gauntlet (load-bearing, v2-architectural).
2. **GWS port** → design (mechanical-ish: reinstall integration + creds).
3. **PKA runtime** → design (paths + venv strategy + subagent access).

## Phase B — designs (decided)

### B. Central message store — gauntlet-validated (`gauntlet-logs/gauntlet-2026-06-08-073159.md`)
Verdict: **host-side archiver + reuse `archive.db`**, agent reads via the existing RO mount; idempotency via a watermark (not a write-back column).
- **Host archiver**: in `routeInbound` (host, sole writer), mirror EVERY inbound message into `data/archive.db` (`messages` + `messages_fts`). DELETE mode → safe live read across the bind mount (gauntlet confirmed `fcntl` locks work across bind mounts; set `busy_timeout` on readers). Reuse archive.db (already mounted RO into owner groups, already FTS) — historical rows stay, live rows append.
- **Correction to gauntlet**: it assumed MCP tools run host-side and could query in-process. In v2 the `nanoclaw` MCP server runs **inside the container**, so there's no in-process host query. The agent reads the RO-mounted `/workspace/extra/archive.db` directly (same path already wired + documented for search-history). No write-back from container (preserves one-writer).
- **"Unread/recent" + idempotency**: triage queries `non-self messages WHERE timestamp > <last_run_watermark>`; the watermark is a file in the agent workspace (e.g. `/workspace/agent/daily_update/triage_state.json` / a triage state file), advanced at end of each run. No `triaged_at` write-back needed (container can't write the host-owned DB).
- Rejected (b) cross-session aggregator (36 scattered DBs, dup data, no FTS). (c) MCP tool alone = needs (a) as backend; direct RO read is simpler given container-side MCP.

### A. GWS (`gws_run`) — design
v1 = MCP server wrapping the `gws` CLI ([[project_gws_integration]]). Port: (1) make the `gws` CLI available in the container (vendor/global-install, pinned); (2) Google OAuth creds reachable in-container (OneCLI vault Google secret + the headless-auth flow [[reference_gws_auth_headless]]) — **NEEDS USER (Google OAuth)**; (3) expose `gws_run` as a nanoclaw MCP tool (or a PATH CLI) matching the task syntax (`gws sheets spreadsheets values append …`, Gmail search/read/trash). Biggest port; gated on user OAuth.

### C. PKA runtime — design (simpler than feared)
Scheduled-task scripts (`inbox_classify.py`, `task_query.py`, `catalog.py`, `onboarding.py`) are **stdlib-only** → python3 (✓ added) runs them; venv (httpx/mcp/cryptography) is only for `embed.py` (embeddings — not a scheduled-task dep → defer). Fixes: (1) task prompts use HOST path `/home/nanoclaw/pka/scripts/` → rewrite to `/workspace/extra/pka/scripts/`; (2) Task **subagents** (consolidation/session-review) need mount read access — verify/extend additionalDirectories or run in main context; (3) embeddings venv = follow-up.

## Phase C — implement + verify each task end-to-end.

---

## Post-cutover finding (2026-06-09): migrated task prompts had EMPTY template slots

Symptom: Morning Triage failed on both data sources — "Gmail: gws proxy 400" and
"WhatsApp: Database path not configured." Root cause was NOT the capabilities
(GWS + archive.db were ready) but the **task prompt itself**: v1 filled certain
slots by runtime template substitution, and the migrated *static* prompt carried
the collapsed/empty slots:
- `"...using ⟨ ⟩ or equivalent read operation"` (empty Gmail tool)
- `"Query the messages database at ⟨ ⟩:"` (empty WhatsApp DB path → the "not configured" error)
- `"Use ⟨ ⟩ to deliver"` (empty send tool)

Fix (applied to the triage task content in the owner session inbound.db): point
the slots at the actual v2 capabilities —
- Gmail → `gws_run({command: "gmail +triage --query 'is:unread newer_than:1d'"})`
- WhatsApp → read-only query against `/workspace/extra/archive.db` (the central
  message store; `messages` table, `is_from_me=0`, `timestamp > now-12h`)
- send → the `send_message` MCP tool

Verified: `gmail +triage` returns real unread mail through the proxy; archive has
266 recent non-self messages; archive.db mounted into the triage group. **Only the
triage task had empty slots** (a swept check found no others; other tasks
reference Sheets/Drive, not a message DB). **Lesson for future migrations:** after
porting capabilities, grep migrated task prompts for empty-slot signatures
(`"at :"`, `"using  or"`, `"Use  to"`, double-spaces in instruction context) —
v1 runtime templating leaves blanks the new static prompt won't fill itself.
