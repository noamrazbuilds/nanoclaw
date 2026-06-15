# Session handoff — 2026-06-15: daily-update incident + resiliency hardening

Context for another session working on this codebase. Covers a production incident on
the owner's Telegram DM agent (`ag-1780848737571-t7hit8`, group folder `telegram_main`)
and five changes made in response. The code/tests + this doc are committed on branch
`v2-migration`; the installation config edit (`config.json`) is untracked. See
"Git / deploy state" at the end.

---

## What happened (the incident)

The owner got a confusing burst of Telegram messages from the Dude's **Daily Update**
(scheduled task `task-1774572694013-gejcab`, cron `31 6 * * 0-5`, runs sonnet,
`suppress_chat_output=true`, delivers via email):

1. A scary raw error: *"API Error: Claude Code is unable to respond… violate our Usage Policy."*
2. A duplicate "Ready to proceed with Step 5 completion… gws_run confirmation with nonce `fab0c073…`".
3. The day's update never sent (`last_run.json` stuck on 2026-06-14).

### Root causes (three compounding)

1. **Anthropic credits exhausted** — the real blocker. Container agents bill to an
   **Anthropic API key injected by the OneCLI gateway** (`onecli secrets list` → type
   `anthropic`), NOT the `CLAUDE_OAUTH_TOKEN` in `.env`. That key hit zero mid-morning.
   Evidence was only in the archived transcript (`groups/telegram_main/conversations/
   2026-06-15-incomplete-session.md` ended with `telegram-dm: Credit balance is too low`)
   because containers run `--rm` and their logs vanish — **host logs showed nothing**.
2. **Content-filter refusal** — one of the Daily Update's parallel news-search subagents
   (the **Anti-Semitism** / Israel-Security section) was refused by Anthropic's Usage-Policy
   classifier. It fires *probabilistically* because the subagent was asked to **reproduce
   hateful content verbatim** while compiling incidents. Not an account flag.
3. **gws nonce + stuck retry** — when the owner manually said "retry", the daily update ran
   as an *interactive* turn (not scheduled), so the gws email send required a confirmation
   nonce (scheduled tasks auto-confirm — `gws-mcp-stdio.ts` line ~300). The agent pasted the
   raw nonce into chat and then couldn't complete the confirm turn (credits gone) → it
   re-emitted the same status (the "duplicate") and hung until the host's absolute-ceiling
   killer reaped it.

---

## Changes made (five)

### 1. Graceful content-policy refusal handling  (container)
- **New** `container/agent-runner/src/policy-refusal.ts` — `isPolicyRefusal()` +
  `POLICY_REFUSAL_NOTICE`. Mirrors the existing `credit-error.ts` pattern.
- `poll-loop.ts` — wired at both surfacing points (thrown-error catch + result-text path).
  Raw "API Error… Usage Policy" no longer reaches chat; interactive turns get a calm note,
  `suppress_chat_output` tasks send nothing.
- Tests: `policy-refusal.test.ts`.

### 2. gws confirmation-nonce never leaks to chat  (container)
- **New** `container/agent-runner/src/chat-redact.ts` — `redactNonce()` strips a 32-hex
  token adjacent to the word "nonce".
- Applied in `mcp-tools/core.ts` (`send_message`) and `poll-loop.ts` (`sendToDestination`,
  the final-output path).
- `gws-mcp-stdio.ts` — instructions tightened: describe the action in plain language, NEVER
  paste the nonce (both the tool description and the `confirmation_required` message).
- Tests: `chat-redact.test.ts`.

### 3. Host error-logging for container-internal API errors  (host + container)
Closes the gap that hid the whole incident — API failures now surface in
`logs/nanoclaw.error.log`.
- `container/agent-runner/src/db/connection.ts` — new `agent_events` table in `outbound.db`
  + `recordAgentEvent(level, kind, detail)`. Emitted from `poll-loop.ts` on
  `credit_exhausted`, `policy_refusal`, `query_error`, `stream_error`.
- `src/db/schema.ts` — `agent_events` added to `OUTBOUND_SCHEMA`; new host-owned
  `agent_events_cursor` (high-water-mark) added to `INBOUND_SCHEMA`.
- `src/host-sweep.ts` — `drainAgentEvents()` (exported) runs each sweep, reads new events
  via the cursor, logs them, advances the cursor in inbound.db. Host never writes
  outbound.db. Forward-compat: creates the cursor table on older inbound.db; tolerates
  missing `agent_events` on older outbound.db.
- Tests: `src/agent-events-drain.test.ts` (exactly-once cursor behavior).

### 4. Anti-Semitism / Israel-Security prompt framing  (installation config, NOT in git)
- `groups/telegram_main/daily_update/config.json` sections 2 & 3: added a *purpose & tone*
  preamble — defensive/safety-awareness framing + "describe incidents factually, never
  reproduce slurs/threats/extremist statements verbatim." This is the real fix for the
  refusals; **coverage is preserved** (owner explicitly wants to keep receiving these).
  Backup: `config.json.bak.pre-refusal-fix`. Live on next run (read at runtime).

### 5. Credit-error fallback wired for the OneCLI topology  (host + container)
The C1 one-shot fallback existed but **never fired here** — it was gated on
`ANTHROPIC_BASE_URL`, which is unset in this OneCLI install (agents reach Anthropic through
the gateway, not a LiteLLM base URL). Rewired so only the *retry* diverts to LiteLLM:
- `src/config.ts` — new `DEFAULT_FALLBACK_MODEL` export (from `.env`, = `gemini-2.5-flash`).
- `src/container-runner.ts` — passes `NANOCLAW_FALLBACK_MODEL` into the container
  (`LITELLM_HOST` + `LITELLM_API_KEY` were already passed).
- `providers/types.ts` + `providers/claude.ts` (container) — new per-call `envOverride`,
  merged over the full base env (keeps PATH/proxy/NO_PROXY).
- `poll-loop.ts` — builds `FALLBACK_ENV` (`ANTHROPIC_BASE_URL=LITELLM_HOST` + auth =
  `LITELLM_API_KEY`), gates on `FALLBACK_READY`, passes `envOverride` on both retry sites.
  Bypasses OneCLI because `host.docker.internal` is in `NO_PROXY` (same bridge
  `generate_image`/TTS already use). LiteLLM confirmed serving `gemini-2.5-flash`.
- Normal path unchanged (still OneCLI → api.anthropic.com). User-facing copy already said
  "re-running on Gemini".

---

## Key architectural facts (learned this session)

- **Agent-runner source is bind-mounted live** into containers (`container/agent-runner/src`
  → `/app/src`, `container-runner.ts:314-316`; run via `exec bun run /app/src/index.ts`).
  Source-only changes need **no image rebuild** — just a new container spawn. Only deps
  (package.json/bun.lock), the Dockerfile, or baked global CLIs require `./container/build.sh`.
  (Host `src/**` changes DO need `pnpm run build` + service restart.)
- **Billing:** all agent model calls bill to the OneCLI-vault Anthropic API key, even though
  `.env` has `CLAUDE_OAUTH_TOKEN`. "Credit balance is too low" = top up that key's console.
- The container build is **memory-heavy** on this 8GB host (OOM'd once mid-build).

---

## Verification done

- Host: typecheck clean; full suite **410 tests pass**; new drain test included.
- Container: typecheck clean (`tsc -p container/agent-runner/tsconfig.json`); new
  policy-refusal + chat-redact tests added (run under `bun` in the image). Regex logic also
  validated via Node since bun isn't on the host.
- Host rebuilt (`pnpm run build`) + restarted (`systemctl --user restart nanoclaw`, active).

## Open threads / NOT done

- **Committed** on branch `v2-migration` (code/tests + this doc). The `config.json` prompt
  edit is installation-specific and stays untracked. Not yet merged/pushed. Deployed via
  build+restart (host) and live mount (container).
- **No live firing test** of the credit-fallback or the refusal path — both need a real
  event (credits were topped up). First occurrence will exercise them; look for
  `notifyCreditFallback`'s "re-running on Gemini" message + a `credit_exhausted` /
  `policy_refusal` line in `nanoclaw.error.log`.
- **Design observation (not fixed):** manually retrying a `suppress_chat_output` scheduled
  task as an interactive turn loses the scheduled-task gws auto-confirm, forcing the nonce
  dance. Could special-case "re-run scheduled task" to preserve auto-confirm.

## Git / deploy state — files touched by THIS session

Container (live on next spawn):
`poll-loop.ts`, `db/connection.ts`, `gws-mcp-stdio.ts`, `mcp-tools/core.ts`,
`providers/claude.ts`, `providers/types.ts`, **new** `policy-refusal.ts`(+test),
**new** `chat-redact.ts`(+test).

Host (built + restarted):
`src/config.ts`, `src/container-runner.ts`, `src/db/schema.ts`, `src/host-sweep.ts`,
**new** `src/agent-events-drain.test.ts`.

Installation config (not tracked in git):
`groups/telegram_main/daily_update/config.json` (+ `.bak.pre-refusal-fix`).

> NOTE: `git status` also shows unrelated pre-existing working-tree changes that are **not
> from this session** — e.g. `groups/global/CLAUDE.md`, `groups/main/CLAUDE.md`,
> `package.json`, `pnpm-lock.yaml`, `setup/whatsapp-auth.ts`, `src/channels/index.ts`,
> `vendor/`, `gauntlet-logs/`. Leave those alone.
