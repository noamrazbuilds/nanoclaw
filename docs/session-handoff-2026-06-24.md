# Session handoff — 2026-06-15→24: gws typed tools, task de-agenting, scheduling-reliability fixes

Context for another session on this codebase. Covers an arc of work on the owner's
Telegram DM agent (`ag-1780848737571-t7hit8`, group folder `telegram_main`) triggered by
a `gws_run` "broken integration" health alert, which expanded into a redesign of how
recurring tasks run. Host code/tests are committed on branch `v2-migration`; the
version-controlled task prompts live in the **PKA vault** (`~/pka/vault/nanoclaw/tasks/
telegram_main/*.{md,json}`, pushed to `github.com/noamrazbuilds/pka` `main`) and are
materialized into live DB rows by `scripts/sync-task-prompts.ts`. Install-local config
(`groups/telegram_main/daily_update/config.json`) is untracked. Deploy/git state at the end.

---

## The triggering alert

A Telegram health alert fired: **`gws_run`: 15/35 failed (43%) in last 24h** — flagged as
"likely a broken integration." It was a **false positive**. Every failure was the agent
guessing wrong gws CLI syntax (`--fileId` vs `--params`, `export` of a non-Google-native
CSV → 403, dotted `spreadsheets.values`). Auth/proxy/Google were all healthy. The monitor
(`scripts/tool_health.py`) couldn't tell "agent typo'd a flag" from "integration down"
because the `tool_calls` ledger stored only tool/status/ts — no error detail.

This exposed two deeper problems: (1) the agent re-derives gws CLI syntax from scratch on
every run, and (2) many recurring "tasks" are mechanical ETL that don't need an LLM at all.

---

## What was built (in order)

### Tier 1 — typed gws MCP tools (`e25860c`)
Added structured tools next to `gws_run` in `container/agent-runner/src/gws-mcp-stdio.ts`:
`sheets_read/update/append/clear`, `drive_find/get/download`, `gmail_search/read/send`.
The agent fills params; the wrapper builds the verified gws argv **server-side**, so it
cannot misspell a flag. Same write-confirmation/non-main/audit guardrails via a shared
`runGuarded()`. `gws_run` stays for the long tail. Skill (`container/skills/
google-workspace/SKILL.md`) updated to prefer them. **All gws tools are named
`mcp__gws__*` in the ledger** (matters for required_tools, see the concert bug below).

### Tier 4 — health monitor stops crying wolf (`44585d7`)
`src/gws-proxy.ts` now classifies every gws result `none`/`client`/`integration` (parsing
the Google error code/reason + clap usage markers) into the audit log. `tool_health.py`
judges gws off that log, counting **only integration-class** failures (auth/quota/5xx/
proxy). Agent CLI-syntax fumbling (client) no longer pages; a real outage still does.
9 unit tests in `src/gws-proxy.test.ts`.

### Tier 3 — de-agenting recurring tasks
The pre-task **script seam** already existed (`container/agent-runner/src/scheduling/
task-script.ts`): a task's `script` runs before the LLM; `wakeAgent:false` skips the LLM
entirely (zero tokens), `data` is injected as `scriptOutput`, and (new this arc, infra
`c6c18f7`) a **script outbox** `send:[{text}]` lets a script deliver chat messages via the
normal outbound path with no LLM. Current task tiers:
- **Fully scripted (no LLM):** PKA inbox review ×2 (`inbox_classify.py --force` self-delivers),
  USD/ILS tracker (BOI fetch→history→Sheet append→Telegram), PKA weekly review.
- **Hybrid prefetch (script gathers data, agent reasons):** PKA morning briefing, weekly
  concert update, morning message triage.
- **Full-agent (kept — genuine synthesis):** daily update, PKA memory consolidation, PKA
  session review.

### The interpreter bug — the big latent one (`4c67541`)
`runScript` always ran `bash <file>`, so a `#!/usr/bin/env python3` script errored on its
first `import`, produced no JSON, and the task was **silently skipped**. This had quietly
disabled morning-briefing / concert / usd-ils / weekly-review / inbox-review from ~06-15
until 06-21 (USD/ILS `history.json` had no entry 06-11→06-22). Fix: pick the interpreter
from the shebang (python3 vs bash). **Verified repaired:** USD/ILS now has 06-22 (2.966)
and 06-23 (2.991) entries. When writing a pre-task script: a pure `.py` needs the python
shebang; a bash script that shells out to python is fine without.

### Orphaned-`.json` guard (`3bcc7e7`)
`sync-task-prompts.ts` paired files one-directionally (`.md`→`.json`), so a task prompt
deleted out from under its sidecar produced NO error — the task kept running a stale DB
prompt. (This is exactly how `pka-inbox-review-afternoon.md` vanished, bundled into an
over-broad `git add -A` in a synced-vault consolidation commit; see the PKA handoff below.)
Now an orphaned `.json` is a loud ERROR + non-zero exit.

### Morning triage redesign (`c4b3e4c` + tuning `c978745`)
The WhatsApp step scanned `archive.db` with `is_from_me=0`, which **includes the
telegram-dm channel where Noam talks TO the assistant** — so his own instructions were
re-surfaced as "important unread messages." Converted to a hybrid prefetch that EXCLUDES
NanoClaw's own channels (`telegram:145958767`, swarm `telegram:-1003894720975`, self-chat
`972523158381@s.whatsapp.net`), bot messages, and hard-muted noisy groups (AI/dev
community, rescue broadcast, Wiz work). Group messages surface only when Noam/Beth/Matan/
Eliana are involved or urgent; DMs pass through. Tuning round also: action/time-sensitive-
only bar, today's-date header (was mislabeled with the prior evening's message date).
**Muted-group JIDs are baked into the prefetch script — update if channels are rewired.**

### Durable double-message guard (`8dca1f0`)
With chat output ON, a task's final-turn assistant text was delivered as a SECOND message
on top of its `send_message` (verified: triage + briefing each sent twice on 06-22).
Replaced the prompt-only "wrap your closing line in `<internal>`" ask with a code
guarantee: a per-turn **delivered-message counter** (DB-backed in `session_state` key
`runtime:messages_delivered_turn`, because the send tools run in a separate MCP subprocess
— same cross-process mechanism as `suppress_chat_output`). `send_message`/`send_file`
increment it; the poll-loop drops the trailing final-result text when
`isTaskTurn && delivered>0`. Interactive turns unaffected; tasks that deliver only via a
final `<message>` block (counter 0) still dispatch. **Verified held:** briefing sent once
on 06-23. **GOTCHA:** do NOT use `suppress_chat_output:true` to fix this for chat-delivered
tasks — it suppresses `send_message` ITSELF (`core.ts:128`), silencing the task; it's only
for email-delivered tasks like the daily update.

### Daily-update content fixes (`c978745`, prompt) + weather (config, untracked)
- Quote no-repeat window 60d→365d + author-name normalization (the "Theodore Roosevelt
  Jr." variant let "Man in the Arena" recur 5×; fixed the source-list name too); keep 400
  quote-history entries so the 365d window isn't starved.
- Wiz/Google news agent Haiku→Sonnet (kept returning empty from shallow search).
- Weather: weather.com/ims.gov.il bot-block (403/404) → switched the section prompt to the
  **Open-Meteo API** (no key, JSON, lat 31.778/lon 35.295) in the install-local
  `groups/telegram_main/daily_update/config.json`.
- Parsha on Mon/Thu/Fri is CORRECT (Torah-reading days) — left unchanged per Noam.

### Concert required_tools fix (`24c2238`, PKA vault)
After the concert task was migrated to the typed gws tools, its honest-failure
`required_tools` still demanded a successful `gws_run` — which it no longer calls. So every
run tripped the C6 honest-failure gate and the real result was blocked (observed 06-23
14:23). Broadened `op_match` `gws_run`→`gws` (substring-matches every `mcp__gws__*` tool).

---

## Known-good vs open threads (as of 2026-06-24)

**Verified working:** USD/ILS (06-22, 06-23 entries), briefing single-send (06-23),
triage prefetch (runs clean in-container), gws health monitor (`gws_run 0/35` after fix).

**Open / watch:**
1. **Anthropic credits.** The 06-23 morning **triage produced nothing** — root cause was
   **credit exhaustion** at 04:16 UTC ("Credit balance is too low" in `nanoclaw.error.log`),
   NOT a code bug. Agents bill to the **OneCLI-injected Anthropic key** (`onecli secrets
   list` → type anthropic), not `.env`. The credit-fallback (Gemini/LiteLLM) also did not
   produce a triage. If recurring tasks go silent, check credits FIRST — container `--rm`
   logs vanish, so the evidence is only in `nanoclaw.error.log` (`credit_exhausted`).
2. **PKA vault deletion guard (#1/#2/#3).** A separate handoff exists at
   `~/pka/docs/2026-06-22-vault-deletion-guard-handoff.md` — the consolidation agent's
   `git add -A` can commit accidental deletions of synced files; do those fixes in a
   `~/pka`-rooted session. The nanoclaw-side detector (#4) is already done (`3bcc7e7`).
3. **Double-message guard** is unit-tested at the counter level but not as a full
   two-process turn; if a regression appears, that's the integration test to add.

---

## Git / deploy state

- **nanoclaw-v2** (`v2-migration`, pushed to origin = `noamrazbuilds/nanoclaw`): commits
  `e25860c` `44585d7` `c6c18f7` `4c67541` `3bcc7e7` `8dca1f0`. All container changes are on
  **live-mounted source** (`/app/src`) → ship on the next container spawn, **no image
  rebuild**. `src/gws-proxy.ts` (Tier 4) is host code — already built + the service was
  restarted when it shipped.
- **PKA vault** (`main`, pushed to `noamrazbuilds/pka`): `6126de4` `32fe033` `53af1c8`
  `c4b3e4c` `c978745` `24c2238`. Vault git history diverges cross-machine (Syncthing
  excludes `.git/`), so these were pushed by cherry-picking onto a worktree at
  `origin/main` — do the same for future vault pushes; do not force the local diverged main.
- **Task prompt edits** take effect via `pnpm exec tsx scripts/sync-task-prompts.ts` (writes
  the active session's live DB rows). `--dry-run` first; it now fails loudly on orphans.
- See memory notes `project_task_deagenting`, `reference_gws_typed_tools`,
  `reference_agent_anthropic_billing` for the durable facts.
