# Session Handoff — v2 migration, capability ports, and silent-failure resilience (2026-06-10)

A compaction/handoff record of an extended work session: the post-cutover
capability ports, the Google Sheet deletion incident, and the silent-failure
resilience hardening pass. Preserves mistake/error learnings, architectural
decisions, and open threads so this line of troubleshooting can continue.

## Current state (TL;DR)
NanoClaw **v2 is LIVE** on WhatsApp + Telegram. The systemd service runs
`node /home/nanoclaw/nanoclaw-v2/dist/index.js` from the `~/nanoclaw-v2` worktree
(branch `v2-migration`); `~/NanoClaw` is untouched on `main` as a pristine v1
rollback. All code porting (Batches 1–5) is done; this session was post-cutover
capability ports + an incident response + a resiliency hardening pass.

## Working conventions / key facts (needed to continue)
- **Commits (nanoclaw repo):** `git -c user.name='noamrazbuilds' -c user.email='noamrazbuilds@users.noreply.github.com' commit` — the noreply email is required (email-privacy push rejection otherwise). Footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Commits (PKA repo, `~/pka`):** `git -c user.name='Noam Raz' -c user.email='noam@raz.net'`. PKA is its own git repo (`main`); **`vault/` is Syncthing-synced and git-ignored** — notes go to `vault/inbox/*.md` (NOT committed; that's correct, not an error). PKA inbox pipeline classifies/routes them.
- **Build/deploy:** host source changes need `pnpm run build` then `systemctl --user restart nanoclaw` (service runs `dist/`). The **agent-runner (`container/agent-runner/src/`) is live-mounted** into containers — source changes ship on next spawn with NO image rebuild. Dockerfile/dep changes need `./container/build.sh` (image tag `nanoclaw-agent-v2-1e478a5f:latest`, install-slug specific).
- **Tests:** `pnpm test` (vitest, **404 passing**; one flaky timing test occasionally shows 1 fail — re-run). Container typecheck: `pnpm exec tsc -p container/agent-runner/tsconfig.json --noEmit`.
- **Ad-hoc DB queries:** `node_modules/.bin/tsx scripts/q.ts <db> "<sql>"` (supports writes via `.run`/`.exec`).
- **Owner agent groups:** `ag-1780848737570-567gy2` (whatsapp_main), `ag-1780848737571-t7hit8` (telegram_main). **Scheduled tasks live in** `data/v2-sessions/ag-1780848737571-t7hit8/sess-1780849157829-1t59wq/inbound.db` (kind='task').
- **Owner identities:** `telegram:145958767`, `whatsapp:972523158381@s.whatsapp.net`. Watchdog alert chat = `145958767`.
- **gws binary (host):** `/home/nanoclaw/.npm/_npx/2d8653d32c8b8c5f/node_modules/@googleworkspace/cli/node_modules/.bin_real/gws` (glibc 2.39; container is bookworm/2.36 — can't run it; no x86_64 musl).
- **UFW rules (machine-local, needed for container→host bridges):** `sudo ufw allow in on docker0 to any port <P> proto tcp` for P ∈ {4000 LiteLLM, 10255 OneCLI, 7850 gws-proxy, 7851 remarkable-proxy}. Symptom of missing rule: container `curl host.docker.internal:<P>` times out.

## Architectural decisions made this session
1. **Central message store** (gauntlet-validated, `gauntlet-logs/gauntlet-2026-06-08-073159.md`): host-side archiver `src/message-archive.ts` mirrors every inbound message in a known chat into `data/archive.db` (sole-writer, `journal_mode=DELETE` for cross-mount RO container reads, FTS5). Hooked into `routeInbound`. Reuses the same archive.db that holds the imported 19,450-msg v1 history (`scripts/build-message-archive.ts`), mounted RO into owner groups at `/workspace/extra/archive.db`. Idempotency = timestamp watermark (no container write-back). VERIFIED live.
2. **GWS = host proxy (Option B, gauntlet `gauntlet-2026-06-08-081404.md`):** `src/gws-proxy.ts` binds `172.17.0.1:7850`, bearer token (`GWS_PROXY_TOKEN`), service allowlist, **hard-blocks destructive Drive ops** (`drive files delete/trash/update-trashed`), serialized exec, audit `data/gws-audit.jsonl`, reads `~/.config/gws/credentials.json` directly. Container `container/agent-runner/src/gws-mcp-stdio.ts` forwards via fetch (creds never enter container). Skill `container/skills/google-workspace`. Per-group `mcp_servers.gws` wiring.
3. **reMarkable = host proxy (same pattern):** `src/remarkable-proxy.ts` `:7851`, READ-ONLY (`scripts/remarkable_fetch.py` calls only rmapi `find`/`get`, then unzip→`rmc` svg→`cairosvg` png). Container `remarkable-mcp-stdio.ts` (tools `remarkable_list`, `remarkable_get_page`) writes PNG to `/workspace/agent/remarkable/` for `send_file`. Skill `container/skills/remarkable`. **Rationale (the user's question drove this): rmapi carries a cloud token + destructive verbs (rm/mv/put) → in-container = the sheet-deletion risk profile; host-proxy keeps token host-side + read-only by construction.**
4. **NO_PROXY fix** (`src/container-runner.ts`): every container gets `NO_PROXY=host.docker.internal,localhost,127.0.0.1` so in-container `fetch()` to our own bridges (LiteLLM:4000, gws:7850, remarkable:7851) **bypasses the OneCLI gateway**, which was routing them through itself and returning HTTP 400. This single fix repaired remarkable + gws + litellm-backed features (generate_image/TTS). `api.anthropic.com` deliberately NOT in NO_PROXY (Claude cred path unaffected; `ANTHROPIC_BASE_URL` unset, `USE_OAUTH=false` in .env but Claude works via OAuth token — verify if touching).
5. **Prevent/Recover/Surface resilience playbook** — now a durable PKA learning note (see below).

## MISTAKES made (preserve as learnings)
1. **Misattributed my own test traffic as agent behavior** — I claimed I "watched the agent reach for `drive files delete` live today," but those audit entries (`fileId:"x"`) were **my own verification curls**. The agent's container-side audit showed ZERO delete attempts. I had to retract "behaviorally demonstrated." **Lesson: when reasoning from telemetry, rigorously separate your own diagnostic traffic from the system's.**
2. **Built a monitor whose own alert silently failed** — tool_health's Telegram alert 400'd because tool names contain underscores (Markdown italic). The detector worked; delivery didn't. **Lesson: verify the whole failure→notify→arrive chain, with the adversarial input.**
3. Earlier mis-framed PKA scheduled-task failures as a capability gap when several were the **empty-template-slot** bug (migrated v1 prompts had blank runtime-substitution slots — e.g. triage's `"Query the messages database at ⟨ ⟩"`). Fixed triage → `gws_run` + archive.db query + send_message. Documented in `migration-notes/capability-ports-plan.md` with the grep signature.
4. Test-harness gotchas: `tsx -e`/`node -e` can't resolve repo modules from `/tmp` (run from repo root or against `dist/`).

## The big incident: Google Sheet deletions (PARTIALLY OPEN)
- **3 agent-WRITTEN sheets permanently hard-deleted** (404, not trashed; trash empty): daily-update quote-log, original concert sheet (already recovered May→`1UYdb5…`), USD/ILS tracker. The 2 survivors were a read-only CSV + the post-incident concert sheet. **Razor-sharp pattern: only scheduled-WRITE targets died; read-only survived** → strongly implicates the agent.
- **Cannot definitively attribute:** the agent acts via OAuth AS noam@raz.net, so consumer Drive Activity API can't distinguish agent-delete from user-delete (and returns 0 records for hard-deleted files). **Only the Workspace Admin Drive audit log can name the actor+app — user said they'd check it manually. THIS IS THE ONE OPEN INVESTIGATION THREAD.**
- **Recovery done:** recreated USD/ILS (from `history.json`, 84 rows) + quote-log (from `quote_recent.json`, 49 quotes); repointed `exchange_rates/config.json` + `daily_update/config.json`. All 3 critical sheets in `data/sheet-backups/sheets.json` + weekly backup timer.
- **Prevention (4 layers):** OAuth downscoped `auth/drive`→`drive.readonly` (re-consent done via `scripts/gws-reauth.py`, fixed-port 8585; proxy reads credentials.json so it took effect live) + proxy hard-block + weekly backups + C6 honest-failure.
- Forensics tool ready: `scripts/drive-incident-forensics.py` (needs Drive Activity API enabled in GCP project `do-openclaw-raz` — was enabled, returns 0 records because files are gone).

## Monitoring/resiliency stack now live (all systemd user timers, machine-local; scripts in repo)
- `nanoclaw-watchdog` (5min) → `scripts/nanoclaw-health-check.sh`: restart service if down + Docker check + Telegram alert. **Hardened this session:** jq-escaped JSON + retry-plain on 400.
- `nanoclaw-tool-health` (3h) → `scripts/tool_health.py`: scans `tool_calls` ledgers (24h window, integration tools only: gws_run/remarkable_*/anylist/send_file/send_message/generate_image, ≥40% fail over ≥3 attempts) AND scans `logs/nanoclaw.error.log` for `"Message delivery failed permanently"`. Deduped, exception-biased, plain-text alerts.
- `nanoclaw-sheet-backup` (weekly Sun) → `scripts/backup-sheets.ts`.
- PKA cron-health folded into the **06:00 morning briefing** via `~/pka/scripts/briefing_health.py` (exception-biased; reads `pipeline/health/*.json`; 12h stale threshold vs 6h watchdog cadence; **Sunday** weekly heartbeat; self-maintaining `pipeline/health/.seen_machines.json` roster). Wired as briefing-task step 2b (verbatim, omit-if-empty).

## Silent-failure hardening (most recent, all committed + live)
The user's instinct: "fix the class, not the bug." We swept all `parse_mode=Markdown` senders. Pattern = **content-dependent output failure with no fallback** (e.g. stray backtick → Telegram 400 → message retried-then-permanently-dropped while agent thinks it sent). Fixes:
- `src/channels/telegram-markdown-sanitize.ts`: strip stray/unbalanced backticks (+3 tests). PREVENT.
- `src/channels/chat-sdk-bridge.ts`: `postTextWithFallback` — on send failure, retry once with markdown-significant chars stripped (plain text). RECOVER. Generic across Chat-SDK channels.
- `scripts/nanoclaw-health-check.sh` + PKA `inbox_classify.py`/`inbox_route.py` `send_telegram`: retry-plain on 400. RECOVER.
- tool_health error-log scan = SURFACE net for any residual drop.
- Arena already had try/catch plain fallback (no change needed).

## Outstanding / deferred (to continue this troubleshooting line)
1. **Workspace Admin Drive audit log** — user to check for definitive sheet-deletion actor/app (the only way to confirm "the agent did it"). Paste rows → interpret.
2. **PKA host crons still erroring** (NOT migration-caused, NOT yet fixed): `inbox-classify` "unable to open database file"; `tag-review` `crsql_internal_sync_bit` (CR-SQLite ext not loaded); `docs-rebuild` `mkdocs: command not found` (PATH); `remarkable-sync` transient `rmapi find failed`. PKA-internal; user hadn't asked to fix yet. (NanoClaw-run inbox classification works fine — different path.)
3. **First real runs** of scheduled tasks (daily-update, triage, concert, USD/ILS, PKA) are the final live proof now that capabilities + triage-prompt + NO_PROXY are fixed — watch C6 honest-failure + tool_health.
4. U5a slots — deferred (design-blocked: non-threaded adapters collapse thread_id).
5. PKA embeddings venv — moot (runs on host cron via python3.12 where venv works; embeddings is host cron, not a NanoClaw task).

## Related artifacts
- **PKA notes** (Syncthing-synced, `vault/inbox/`): `2026-06-08-agent-delete-behavior-note.md` (why a flailing agent reaches for delete; the misattribution correction); `2026-06-10-silent-failure-patterns-resilience.md` (the failure class + prevent/recover/surface playbook; tags `software-engineering/resilience, learning/debugging, claude-learnings/best-practices, tech/nanoclaw, tech/infrastructure`).
- **Memory files updated:** `incident_concert_sheet_disappearance.md`, `project_nanoclaw_v2_upgrade.md`, `project_model_arena.md`, `MEMORY.md`.
- **Docs:** `docs/install-local-setup-checklist.md` (everything non-git a fresh clone needs), `migration-notes/cutover-runbook.md`, `migration-notes/capability-ports-plan.md`.
