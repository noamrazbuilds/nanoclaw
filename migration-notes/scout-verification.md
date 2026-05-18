# Scout Verification — 2026-05-15

Verifier re-checked four load-bearing claims from `migration-notes/v2-scout-report.md` against `upstream/main @ fa945a1` and `origin/main @ 8d42685`. All evidence cited file:line from `git show <ref>:<path>` output.

## Summary

| Claim | Verdict |
|---|---|
| 1. tasks data loss (`model`, `suppress_chat_output` dropped) | **CONFIRMED** |
| 2. v2 has no native credit-error / provider-fallback handling | **CONFIRMED** |
| 3. BLOB→TEXT prompt coercion obsolete in v2 | **CONFIRMED** |
| 4. OneCLI obsoletes `src/oauth-refresh.ts` | **WRONG** |

---

## Claim 1 — tasks migration silently drops `model` and `suppress_chat_output`

**Verdict: CONFIRMED.**

Fork's `scheduled_tasks` table has both columns (verified live against `/home/nanoclaw/NanoClaw/store/messages.db`):

```
13|model|TEXT|0||0
14|suppress_chat_output|INTEGER|0|0|0
```

`upstream/main:setup/migrate-v2/tasks.ts` reads v1 rows with `SELECT *` (line 87), but the `insertTask` payload only preserves `prompt`, `script`, and `context_mode`:

```
upstream/main:setup/migrate-v2/tasks.ts:138-142
content: JSON.stringify({
  prompt: t.prompt,
  script: t.script ?? null,
  migrated_from_v1: { original_id: t.id, context_mode: t.context_mode ?? null },
}),
```

v2 has no place to put `model` or `suppress_chat_output`:
- `upstream/main:src/db/schema.ts:158-184` defines `messages_in` with TEXT-only columns; the only freeform field is `content TEXT NOT NULL`.
- `git grep -iE 'suppress|model.*task|task.*model'` across `upstream/main:src/` returns no hits for either concept.
- v2's task content JSON shape used by the runtime (`upstream/main:src/modules/scheduling/actions.ts:37`) is `{ prompt, script }` only.

**Truth:** Scout was correct. Both columns are silently dropped. To preserve them, either (a) extend the migration to inline a `model:` directive in the prompt, (b) port suppress_chat_output as a v2 module migration adding a `flags` JSON column, or (c) accept the loss and document it. Recommend (a) for `model` (no native v2 equivalent), and revisiting (c) for `suppress_chat_output` if the fork's quiet-task feature is no longer wanted.

---

## Claim 2 — v2 has NO native credit-error handling / provider fallback

**Verdict: CONFIRMED.**

`upstream/main:src/circuit-breaker.ts` is **only** a startup-restart backoff:

```
upstream/main:src/circuit-breaker.ts:7
const CB_PATH = path.join(DATA_DIR, 'circuit-breaker.json');
...
:13-15  interface CircuitBreakerState { attempt: number; timestamp: string; }
:54-67  enforceStartupBackoff() — increments attempt on non-clean shutdown, sleeps per BACKOFF_SCHEDULE_S
```

It gates `index.ts` startup only (`upstream/main:src/index.ts:69` comment: "Circuit breaker — backoff on rapid restarts"). Nothing about provider errors.

`upstream/main:src/providers/` has only three files: `claude.ts`, `index.ts`, `provider-container-registry.ts`. `claude.ts` only injects `ANTHROPIC_BASE_URL` + a placeholder auth token (lines 21-27). `index.ts` is a one-line barrel comment. No fallback logic.

`git grep -iE 'credit|529|insufficient.quota|balance|fallback.*model|model.*fallback|switchProvider'` across `upstream/main:src/` returns zero hits. `git grep -iE 'gemini|openai|litellm|vertex'` against `upstream/main:src/` returns zero hits (only `ANTHROPIC_BASE_URL` matches in `src/providers/claude.ts:13`).

Container-side acknowledgement of quota errors exists but is *cosmetic*. `upstream/main:container/agent-runner/src/providers/claude.ts` translates SDK `rate_limit_event` to `{type:'error', classification:'quota', retryable:false}` (visible in the streamed event handler near line ~298), and `upstream/main:container/agent-runner/src/poll-loop.ts:412-416` simply logs the error:

```
case 'error':
  log(`Error: ${event.message} (retryable: ${event.retryable}${event.classification ? `, ${event.classification}` : ''})`);
  break;
```

No retry, no switch, no backup model.

**Truth:** Scout was correct. The fork's `src/scheduled-task-runner.ts` credit-fallback to `gemini-2.5-flash` (commit 8d42685, `3f2194b`) has no v2 equivalent and must be ported as a customization, not assumed to exist.

---

## Claim 3 — BLOB→TEXT prompt coercion is obsolete in v2

**Verdict: CONFIRMED.**

`upstream/main:src/db/schema.ts` declares zero BLOB columns. The relevant `messages_in` and `messages_out` rows store content as `TEXT NOT NULL`:

```
upstream/main:src/db/schema.ts:158-184  CREATE TABLE IF NOT EXISTS messages_in (...)
  :173    content        TEXT NOT NULL,

upstream/main:src/db/schema.ts:218-234  CREATE TABLE IF NOT EXISTS messages_out (...)
  :234    content        TEXT NOT NULL
```

`git grep BLOB upstream/main -- src/` returns zero hits (only false-positives in `src/channels/adapter.ts:52` and `src/types.ts:151,165` where comments say "JSON blob" referring to a JSON-encoded string field, not SQLite BLOB type).

The bind path is JSON-string only:

```
upstream/main:src/modules/scheduling/db.ts:30-37
db.prepare(`INSERT INTO messages_in (... content ...) VALUES (..., @content, ...)`).run({ ...task, seq: ... });
```

`task.content` is typed `string` (line 28) and constructed via `JSON.stringify(...)` at every call site (e.g. `upstream/main:src/modules/scheduling/actions.ts:37`, `upstream/main:setup/migrate-v2/tasks.ts:138-142`). No Buffer ever binds to a prompt field.

`git grep -iE 'Buffer\.from|Buffer\.alloc' upstream/main -- src/modules/scheduling/ src/db/` returns zero hits.

**Truth:** Scout was correct. The fork's recent fix (commit 8d42685, "BLOB prompt coercion guard") becomes a no-op in v2 — the bug surface is structurally gone. Do not port the guard.

---

## Claim 4 — OneCLI obsoletes `src/oauth-refresh.ts`

**Verdict: WRONG.**

The fork's `oauth-refresh.ts` solves an orthogonal problem to what OneCLI handles. Both can (and should) coexist.

### What `oauth-refresh.ts` actually does (`origin/main:src/oauth-refresh.ts`)

It's a **host-side daemon** that proactively refreshes the Claude OAuth token before expiry by calling `https://platform.claude.com/v1/oauth/token` directly from the NanoClaw host:

```
origin/main:src/oauth-refresh.ts:117    grant_type: 'refresh_token',
origin/main:src/oauth-refresh.ts:124    hostname: 'platform.claude.com',
origin/main:src/oauth-refresh.ts:134-136
  if (OAUTH_PROXY_URL) {
    requestOptions.agent = new SocksProxyAgent(OAUTH_PROXY_URL);
  }
origin/main:src/oauth-refresh.ts:12     import { SocksProxyAgent } from 'socks-proxy-agent';
```

The SOCKS5 routing through the Synology NAS (per the user's `reference_oauth_proxy_setup` memory) is required because Cloudflare blocks the NanoClaw host's datacenter IP at the OAuth endpoint. Without the tunnel, refresh requests fail at the network layer.

### What OneCLI actually does (`upstream/main:container/skills/onecli-gateway/SKILL.md`)

OneCLI is a **container-side HTTPS proxy** that intercepts outbound traffic *from inside agent containers* and injects credentials:

```
upstream/main:container/skills/onecli-gateway/SKILL.md:13-17
Your outbound HTTPS traffic is transparently proxied through the OneCLI
gateway, which injects stored credentials at the proxy boundary. You never
see or handle credential values directly.

upstream/main:container/skills/onecli-gateway/SKILL.md:1-2 (frontmatter)
compatibility: Requires HTTPS_PROXY set in environment (automatic when launched via `onecli run`)
```

The host wires it via `HTTPS_PROXY` env var passed to the container at spawn:

```
upstream/main:src/container-runner.ts:421-428
// OneCLI gateway — injects HTTPS_PROXY + certs so container API calls
// are routed through the agent vault for credential injection. ...
const onecliApplied = await onecli.applyContainerConfig(args, { addHostMapping: false, agent: agentIdentifier });
if (!onecliApplied) {
  throw new Error('OneCLI gateway not applied — refusing to spawn container without credentials');
}
```

OneCLI's `applyContainerConfig` only mutates the container spawn args (`args.push(...)`). The host process itself has no `HTTPS_PROXY` set by OneCLI, so any host-side `https.request(...)` to `platform.claude.com` would go direct, hit Cloudflare's block, and fail.

### Neither OneCLI nor the native credential proxy auto-refreshes Anthropic OAuth

`git grep -iE 'grant_type|refresh_token|platform\.claude'` across all of `upstream/main` returns only Gmail/GCal MCP stub fixtures (`add-gcal-tool/SKILL.md:62`, `add-gmail-tool/SKILL.md:60`) — none for Anthropic. The native credential proxy's own SKILL.md confirms the manual fallback:

```
upstream/main:.claude/skills/use-native-credential-proxy/SKILL.md (troubleshooting)
**OAuth token expired (401 errors):** Re-run `claude setup-token` in a terminal and update the token in `.env`.
```

So v2 expects the user to manually re-run `claude setup-token` when the token expires — every 1 hour for Claude Max subscriptions. The fork's auto-refresh daemon avoids this manual loop entirely.

**Truth:** OneCLI is *complementary*, not a replacement. After porting to v2, `src/oauth-refresh.ts` should still be kept (and ported) for any user running on a Cloudflare-blocked IP with a Claude Max subscription. The Synology SOCKS5 setup remains required.

---

## Recommended adjustments to the migration plan

1. **`migration-notes/phase-1-prep.md`** — under whichever section enumerates "things to port from fork":
   - Add `src/oauth-refresh.ts` to the **port list** (was previously flagged as possibly-obsolete). Note: depends on `socks-proxy-agent` npm package and `OAUTH_PROXY_URL` config in `.env`. Initialization happens at host startup in `src/index.ts` and stops on shutdown.
   - Keep `src/scheduled-task-runner.ts` credit-fallback logic on the port list — confirmed not present in v2.
   - Remove the "BLOB prompt coercion guard" (commit 8d42685's second half) from the port list — v2's schema makes the bug structurally impossible.

2. **Task migration extension (`setup/migrate-v2/tasks.ts` customization)** — when porting, extend the content-JSON payload to preserve `model` and `suppress_chat_output`:
   ```ts
   content: JSON.stringify({
     prompt: t.prompt,
     script: t.script ?? null,
     model: t.model ?? null,                                // NEW
     suppress_chat_output: t.suppress_chat_output ? 1 : 0,  // NEW
     migrated_from_v1: { original_id: t.id, context_mode: t.context_mode ?? null },
   }),
   ```
   …plus a corresponding runtime change so the scheduling executor honors those fields. Without the runtime change, the migration is just preservation, not function.

3. **Document the OneCLI vs oauth-refresh distinction** in `migration-notes/phase-1-prep.md` so future Porter agents don't drop oauth-refresh on the "OneCLI replaces this" assumption.
