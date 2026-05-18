# Verifier-2 Report — 2026-05-18

Third-pass verification of eight remaining claims on the v1→v2 work queue (`migration-notes/phase-1-prep.md`). Refs: `upstream/main @ fa945a1`, `upstream/channels` (channels skill branch), `origin/main @ 8d42685`.

## Summary

| Claim | Verdict | Implied queue action |
|---|---|---|
| 1. U1 — v2 has native voice→text | WRONG (no native v2 transcription on WhatsApp) | KEEP as full port (Phase 1a blocker confirmed) |
| 2. F2 — v2 uses same `.mcp.json` mount convention as fork | WRONG (different convention) | REPLACE — wire AnyList via `container_configs.mcp_servers` JSON, not `.mcp.json` |
| 3. F3 — `link-to-audio` container skill exists upstream | WRONG (not in upstream) | PORT — full skill copy, no upstream version exists |
| 4. F4 — v2 handles OneCLI CA cert persistence + auto-extract natively | PARTIALLY-CORRECT (container side is in SDK; the fork's only host-side cert code is `scripts/backup-memory.sh`) | NARROWED — only the backup-memory script needs porting; no container-runner cert work |
| 5. U3 — v2 heartbeat subsumes `status-tracker.ts` | WRONG (different purpose: liveness vs UX reactions) | KEEP as port (not "drop or trivial adapter") |
| 6. Reactions | PARTIALLY-CORRECT (outbound only — inbound capture missing) | PORT inbound half (Baileys `messages.reaction` listener + `reactions` table + reactor metadata) |
| 7. Crash-safe transcripts | PARTIALLY-CORRECT (structured per-turn writes ARE continuous via `messages_in/out` + SDK `.jsonl`; only the markdown summary archive is exit-time-only) | NEEDS-SPEC — narrow to "port SIGTERM markdown archive handler"; not a wholesale crash-safe rebuild |
| 8. Audit log | WRONG (no `task_audit_log` or equivalent in v2) | ADD ROW — new C5 item: port `task_audit_log` table + write sites |

---

## Claim 1 (U1) — Voice-to-text in v2

**Verdict: WRONG. v2 has NO native WhatsApp transcription.**

Evidence:

- Upstream's WhatsApp adapter (`upstream/channels:src/channels/whatsapp.ts`) downloads `audioMessage` to disk but does NOT transcribe:
  ```
  upstream/channels:src/channels/whatsapp.ts:343    { key: 'audioMessage', type: 'audio', ext: '.ogg' },
  ```
  The `downloadInboundMedia` flow saves to `attachments/` and returns the file path; no STT.
- Upstream Signal adapter DOES have native whisper-cpp + OpenAI fallback:
  ```
  upstream/channels:src/channels/signal.ts:364  async function transcribeAudioOptional(filePath: string)
  upstream/channels:src/channels/signal.ts:365    const whisperBin = process.env.WHISPER_BIN;
  upstream/channels:src/channels/signal.ts:634        const transcript = await transcribeAudioOptional(attachmentPath);
  ```
  …so the *upstream pattern* exists, but it's Signal-only on trunk. The WhatsApp channel does not opt in.
- Voice transcription on WhatsApp lives behind a separate **skill branch**, not on trunk:
  - `whatsapp/skill/voice-transcription` (skill branch on `qwibitai/nanoclaw-whatsapp`) ships an `add-voice-transcription` SKILL.md.
  - `whatsapp/skill/local-whisper` ships `use-local-whisper`.
  - On `upstream/main`, `.claude/skills/` contains **neither** (verified by listing `.claude/skills/`).
- Documentation confirms the Signal-only default:
  ```
  upstream/main:.claude/skills/add-signal/SKILL.md:264
  Voice attachments — detected but not transcribed by default; the agent receives
  `[Voice Message]` placeholder text. Run `/add-voice-transcription` for local transcription
  ```
- `upstream/main:CHANGELOG.md:134` references `/use-local-whisper` as an added skill, not core.

**Queue action: KEEP U1 as Phase 1a blocker.** Either port the fork's `src/transcription.ts` (OpenAI Whisper API client) or apply the `whatsapp/skill/voice-transcription` skill branch (it borrows Signal's `transcribeAudioOptional` pattern). The fork's existing implementation is OpenAI Whisper API — re-implement against the v2-style hook in the WhatsApp adapter's `downloadInboundMedia`.

---

## Claim 2 (F2) — `.mcp.json` mount convention

**Verdict: WRONG. v2 uses a different convention.**

Fork uses `.mcp.json` SDK discovery via filesystem walk:
```
origin/main:src/container-runner.ts:171   // Mount .mcp.json into the group working directory so the Claude SDK
origin/main:src/container-runner.ts:174   // discovers MCP servers (it walks up from CWD, which is /workspace/group...)
origin/main:src/container-runner.ts:181        containerPath: '/workspace/group/.mcp.json',
```

v2 uses a DB-backed `container.json` that the agent-runner reads explicitly and passes to SDK as a programmatic `mcpServers` argument:
```
upstream/main:src/container-runner.ts:273   // container.json — nested RO mount on top of RW group dir
upstream/main:src/container-runner.ts:275   const containerJsonPath = path.join(groupDir, 'container.json');
upstream/main:src/container-runner.ts:277   mounts.push({ hostPath: containerJsonPath, containerPath: '/workspace/agent/container.json', readonly: true });

upstream/main:container/agent-runner/src/index.ts:84-91
  for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
    mcpServers[name] = serverConfig;
    log(`Additional MCP server: ${name} (${serverConfig.command})`);
  }
  const provider = createProvider(providerName, { ..., mcpServers, ... });

upstream/main:src/container-config.ts:34       mcpServers: Record<string, McpServerConfig>;
upstream/main:src/db/migrations/014-container-configs.ts:9   CREATE TABLE container_configs (
```

`upstream/main:.mcp.json` itself is an empty stub (`{ "mcpServers": {} }`).

**Queue action: REPLACE F2.** Port AnyList by inserting/updating `container_configs.mcp_servers` JSON for the relevant group, **not** by mounting `.mcp.json`. Specifically: write `{"anylist": {"command":"node","args":["..."],"env":{...}}}` into the row for the target group. The path needs to resolve **inside the container** — verify the AnyList MCP source is mounted (via `container_configs.additional_mounts`) or that the node entrypoint is bundled in the image.

---

## Claim 3 (F3) — `link-to-audio` exists in upstream

**Verdict: WRONG. Upstream has no `link-to-audio` skill.**

```
upstream/main:container/skills/  →  agent-browser, frontend-engineer, onecli-gateway,
                                     self-customize, slack-formatting, vercel-cli, welcome
```

No match for `link-to-audio`, `audio`, `tts`, `article`, or `link` (verified `git grep -iE 'link.*audio|article.*tts|url.*tts|read.*aloud' upstream/main` → zero hits).

Fork has the full skill at `origin/main:container/skills/link-to-audio/{SKILL.md, scripts/extract.py, scripts/link2audio.py}`.

**Queue action: PORT F3 in full.** Self-contained — copy `container/skills/link-to-audio/` into v2 worktree, add to `container_configs.skills` for the relevant group, ensure `OPENAI_API_KEY` is wired through OneCLI vault.

---

## Claim 4 (F4) — OneCLI CA cert persistence + auto-extract

**Verdict: PARTIALLY-CORRECT — but the fork's "customization" is smaller than the queue row implies.**

What the **container-side** lifecycle looks like in v2: handled inside `@onecli-sh/sdk` via `onecli.applyContainerConfig(args, ...)` — the SDK injects `HTTPS_PROXY` and the CA cert into spawn args. No NanoClaw code touches certs:
```
upstream/main:src/container-runner.ts:10   import { OneCLI } from '@onecli-sh/sdk';
upstream/main:src/container-runner.ts:421-429   // OneCLI gateway — injects HTTPS_PROXY + certs
                                                  const onecliApplied = await onecli.applyContainerConfig(...)
```
The fork imports the **same SDK** the same way:
```
origin/main:src/container-runner.ts:33    import { OneCLI } from '@onecli-sh/sdk';
origin/main:src/container-runner.ts:431   const onecliApplied = await onecli.applyContainerConfig(args, ...)
```
`upstream/main:container/build.sh` does NOT bake any CA cert into the image. `git grep -iE 'CA.cert|ca_cert|ca\.crt|extract.*cert' upstream/main -- src/ container/ setup/ scripts/` returns ONE hit (the `applyContainerConfig` comment quoted above).

What the **host-side** cert work in the fork actually is:
```
origin/main:scripts/backup-memory.sh:30    ONECLI_CA="$PROJECT_ROOT/data/onecli-proxy-ca.pem"
origin/main:scripts/backup-memory.sh:291-294
  # Ensure OneCLI CA cert exists (extract from container if missing)
  if [ ! -f "$ONECLI_CA" ]; then
    log "CA cert missing — extracting from OneCLI container"
    docker compose -f "$HOME/.onecli/docker-compose.yml" exec -T app cat /app/data/gateway/ca.pem > "$ONECLI_CA" 2>/dev/null || true
  fi
```
That's the ENTIRE cert lifecycle code in the fork: one block in a host script that extracts the cert from the OneCLI docker-compose deployment so the *backup-memory.sh* script can make AI calls via the OneCLI proxy. Not a container-runner customization.

The fork's `docs/docker-sandboxes.md` (lines 109, 148-157, 300) discusses `NODE_EXTRA_CA_CERTS` but it's **documentation only** — no code in `src/` or `container/` references those env vars on the fork.

**Queue action: NARROW F4.** Rename to "Port `scripts/backup-memory.sh` cert-extract idiom for host-side OneCLI proxy calls" — only matters if `backup-memory.sh` itself is on the port list. There is **no container-runner or build.sh cert work** to port; OneCLI SDK handles that. Drop the "auto-extract into containers" framing.

---

## Claim 5 (U3) — v2 heartbeat subsumes `status-tracker.ts`

**Verdict: WRONG. Different purposes; no overlap.**

Fork's status-tracker:
```
origin/main:src/status-tracker.ts:10-16
  export enum StatusState { RECEIVED=0, THINKING=1, WORKING=2, DONE=3, FAILED=3 }
origin/main:src/status-tracker.ts:73-91   markReceived → enqueues a 👀 reaction on the inbound message
origin/main:src/status-tracker.ts:94-99   markThinking → 💭, markWorking → 🔄
origin/main:src/status-tracker.ts:52-60
  sendReaction: (chatJid, messageKey, emoji) => Promise<void>;
```
This is a **user-facing UX feature**: emoji reactions on the user's inbound message that mark progress (eyes → bulb → cycle → done).

v2 heartbeat:
```
upstream/main:container/agent-runner/src/db/connection.ts:25
  const DEFAULT_HEARTBEAT_PATH = '/workspace/.heartbeat';
upstream/main:container/agent-runner/src/db/connection.ts:152
  Touch the heartbeat file — replaces the old touchProcessing() DB writes.
upstream/main:src/container-runner.ts:173
  // sweep reading heartbeat mtime + processing_ack claim age + container_state
upstream/main:src/host-sweep.test.ts:37
  it('returns kill-ceiling when heartbeat older than 30 min', ...
```
This is **infrastructure**: liveness signal so the host-sweep can kill stuck containers. Never user-visible.

These mechanisms don't share information. The fork's status-tracker depends on `sendReaction` (outbound reactions) and `isMainGroup` — neither is plumbed for status purposes in v2.

**Queue action: KEEP U3 as a port, not a drop.** Hook point in v2 is per-message in the WhatsApp adapter (after `downloadInboundMedia` for `markReceived`, after agent reply send for `markDone`). Requires the outbound reaction operation that already exists in v2 (`upstream/channels:src/channels/whatsapp.ts:701-712`) plus a small state map keyed by inbound `id`. Update phase-1-prep.md row U3 to drop the "Likely fold into v2's existing heartbeat — drop or trivial adapter" note.

---

## Claim 6 — Reactions (inbound + outbound)

**Verdict: PARTIALLY-CORRECT. v2 has outbound; inbound is missing entirely.**

Outbound (v2 has it):
```
upstream/main:container/agent-runner/src/mcp-tools/core.ts:225
  description: 'Add an emoji reaction to a message.',
upstream/main:container/agent-runner/src/mcp-tools/core.ts:255
  content: JSON.stringify({ operation: 'reaction', messageId: platformId, emoji }),
upstream/channels:src/channels/whatsapp.ts:701-712
  if (content.operation === 'reaction' && content.messageId && content.emoji) {
    await sock.sendMessage(platformId, { react: { text: content.emoji as string, key: {...} } });
```

Inbound (v2 does NOT have it):
- `upstream/channels:src/channels/whatsapp.ts:540` registers `sock.ev.on('messages.upsert', ...)` only. The `messages.reaction` Baileys event is never registered (verified `git grep -nIE 'messages\.reaction|sock\.ev\.on.*reaction' upstream/channels upstream/main` → zero hits).
- Inbound message normalization at `upstream/channels:src/channels/whatsapp.ts:556-573` extracts only `conversation`, `extendedTextMessage.text`, image/video captions. `reactionMessage` content type is not parsed.
- No reactions table: `git ls-tree -r upstream/main src/db/migrations/` shows no reactions migration; `git grep -iE 'reactor_jid|reactions\b'` returns zero hits in `src/`.

Fork has BOTH halves:
```
origin/main:src/channels/whatsapp.ts:408-428
  this.sock.ev.on('messages.reaction', async (reactions) => {
    for (const { key, reaction } of reactions) { ...
      reactor_jid: reactorJid, ...
```
Plus the `reactions` table (referenced in `src/db.test.ts:490-561` with `getReactionsForMessage`, `reactor_jid`, `reactor_name`, `emoji`, ordered by timestamp).

**Queue action: PORT inbound half.** Add a new sub-row (or expand CH1 in phase-1-prep.md). The work:
1. Register `messages.reaction` listener in the WhatsApp fork's adapter.
2. Add a `reactions` table migration to v2 (`src/db/migrations/0XX-reactions.ts`) with columns: `message_id`, `chat_jid`, `reactor_jid`, `reactor_name`, `emoji`, `timestamp`.
3. Add a host-side handler + (optionally) an MCP tool `mcp__nanoclaw__get_reactions(messageId)` so the agent can read them.

---

## Claim 7 — Crash-safe transcripts

**Verdict: PARTIALLY-CORRECT. Structured state IS continuously persisted in v2; only the markdown archive is exit-time-only.**

What's continuously persisted in v2:
- Inbound messages → `messages_in` table at receive time (`upstream/main:src/db/session-db.ts:125` `INSERT INTO messages_in`).
- Agent outbound turns → `messages_out` table per-call from inside the container (`upstream/main:container/agent-runner/src/db/messages-out.ts:60-82` — `writeMessageOut` runs synchronously on every `send_message` MCP tool call).
- SDK conversation `.jsonl` transcript at `/workspace/group/.claude/projects/<...>/<sessionId>.jsonl` — Claude SDK writes per turn. Resume path:
  ```
  upstream/main:container/agent-runner/src/poll-loop.ts:54-60
    // Resume the agent's prior session from a previous container run if one
    // was persisted. The continuation is opaque to the poll-loop — the
    // provider decides how to use it (Claude resumes a .jsonl transcript ...)
  upstream/main:container/agent-runner/src/providers/claude.ts:251
    const STALE_SESSION_RE = /no conversation found|ENOENT.*\.jsonl|session.*not found/i;
  ```

What is NOT continuous in v2:
- The **markdown transcript archive** at `/workspace/agent/conversations/<date>-<name>.md` is only written via the `PreCompact` SDK hook:
  ```
  upstream/main:container/agent-runner/src/providers/claude.ts:184-228
    function createPreCompactHook(assistantName?: string): HookCallback { ...
    fs.writeFileSync(path.join(conversationsDir, filename), formatTranscriptMarkdown(...));
  ```
  No SIGTERM/SIGINT handler exists in `upstream/main:container/agent-runner/src/index.ts` (verified — `grep -iE 'SIGTERM|SIGINT|archive|exit'` returns one hit: `process.exit(1)`).

What the fork adds:
```
origin/main:container/agent-runner/src/index.ts:763-769
  // SIGTERM handler: archive transcript before Docker kills us
  process.on('SIGTERM', () => {
    if (sigTermHandled) return;
    sigTermHandled = true;
    log('SIGTERM received, archiving transcript before exit');
    archiveTranscriptOnExit(sessionId, containerInput.assistantName, true);
    process.exit(0);
  });
origin/main:container/agent-runner/src/index.ts:817-823
  // Clean exit: archive transcript if PreCompact didn't already
  // Error exit: archive what we have, marked as incomplete
```

**Queue action: NEEDS-SPEC — narrow to "port SIGTERM markdown-archive handler."** Don't frame as a wholesale crash-safe rebuild; the structured turns are already safe in v2 via the SQLite + `.jsonl` writes. The deliverable is ~30 lines in `container/agent-runner/src/index.ts`: SIGTERM + clean-exit + error-exit branches that reuse the existing `PreCompact` archive logic. Memory note `project_crash_safe_transcripts` should be updated to reflect this narrowed scope.

---

## Claim 8 — `task_audit_log` table or equivalent in v2

**Verdict: WRONG. v2 has nothing equivalent.**

Fork:
```
origin/main:src/db.ts:192-202
  CREATE TABLE IF NOT EXISTS task_audit_log (
    ... task_id ..., action TEXT, source TEXT,
    before_snapshot ..., after_snapshot ..., timestamp ...
  );
  CREATE INDEX idx_task_audit_task_id ON task_audit_log(task_id);
  CREATE INDEX idx_task_audit_timestamp ON task_audit_log(timestamp);
origin/main:src/db.ts:647
  `INSERT INTO task_audit_log (timestamp, task_id, action, source, before_snapshot, after_snapshot)`
```

v2:
- Migrations list (`upstream/main:src/db/migrations/`): `001-initial`, `002-chat-sdk-state`, `008-dropped-messages`, `009-drop-pending-credentials`, `010-engage-modes`, `011-pending-sender-approvals`, `012-channel-registration`, `013-approval-render-metadata`, `014-container-configs`, `015-cli-scope`, plus three module-prefixed ones. No audit-log table.
- `git grep -iE 'audit|history|changelog|before_payload|after_payload|previous_value' upstream/main -- src/db/ src/modules/scheduling/` → zero hits.
- `upstream/main:src/modules/scheduling/{actions,db,index,recurrence}.ts` has CRUD on `messages_in` rows (task rows) but no mutation log.

**Queue action: ADD a new row in phase-1-prep.md.** Suggested as **C5** under Phase 1b:
| C5 | `task_audit_log` table + write hooks | `src/db.ts` (fork) | Porter-Core | new migration `0XX-task-audit-log.ts` + write hooks in `src/modules/scheduling/actions.ts` (create/update/delete sites) | Used by the fork's daily-update task and ad-hoc prompt edits to record mutations with before/after snapshots. Without it, scheduled-task tampering is unauditable. |

C4 (footnote 1 in phase-1-prep.md references the fork's audit log when describing how the daily-update prompt was edited "earlier today") implicitly depends on C5.

---

## Recommended queue adjustments

1. **Phase 1a — U1 (transcription):** keep as full port (was already correctly described as "blocking everything else"). Remove the "Check Scout §5" hedge in the v2-hook column and replace with: "Apply `whatsapp/skill/voice-transcription` skill OR re-implement OpenAI Whisper call against v2's `downloadInboundMedia`." OpenAI Whisper API client is preferable for parity with current fork behavior.

2. **Phase 1b — F2 (AnyList MCP):** rewrite the row. v2 hook is `container_configs.mcp_servers` JSON column, NOT `.mcp.json` file mount. Update the row's v2-hook column from "v2 `.mcp.json` / skill" to "`container_configs.mcp_servers` (DB-driven, see `src/container-config.ts:34`)." Note that AnyList MCP source needs to be available **inside the container** — either bundled in image or mounted via `container_configs.additional_mounts`.

3. **Phase 1b — F3 (link-to-audio):** confirm full port (no upstream version). v2 hook is `container/skills/link-to-audio/` directly + add to `container_configs.skills` (per-group skill selection). Already framed correctly in phase-1-prep.md; just confirm scope.

4. **Phase 1b — F4 (CA cert):** narrow to "scripts/backup-memory.sh cert-extract block." Remove implication that container-runner cert mount or build.sh bake-in needs porting; those are SDK-internal.

5. **Phase 1b — ADD C5 (task_audit_log):** new row per Claim 8 above. Without this, Phase 1b's C4 (daily-update hardening) loses its audit trail prerequisite.

6. **Phase 1b — ADD inbound-reactions sub-row** (either expand CH1 or add F6): port `messages.reaction` listener + `reactions` table migration + optional `get_reactions` MCP tool. v2 outbound reactions cover the agent→user path only; the fork stores user→message reactions which are referenced by some skills (`/add-reactions`, container skill `reactions`).

7. **Phase 1c — U3 (status-tracker):** flip from "likely drop or trivial adapter" to "PORT." v2 has no UX-facing per-message progress reactions; this is a true customization, not infra overlap. Hook point: WhatsApp adapter's inbound message handler + agent reply send path. Depends on the outbound-reactions operation that already exists in v2.

8. **Crash-safe transcripts:** add a small entry (call it U6 or fold into U3 vicinity) — "Port SIGTERM markdown-archive handler in `container/agent-runner/src/index.ts`." Scope: ~30 lines, reuse existing `PreCompact` archive function. Do NOT frame as a wholesale crash-safe rebuild — structured persistence is already safe in v2 via per-turn DB writes + SDK `.jsonl`.

9. **Memory updates after queue lock:** update `project_crash_safe_transcripts` (narrow scope), `reference_anylist_mcp_setup` (mention `container_configs.mcp_servers` for v2 install), and confirm `project_nanoclaw_v2_upgrade` reflects the audit-log + status-tracker + inbound-reactions additions.
