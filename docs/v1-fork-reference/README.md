# v1 Fork Reference — READ ONLY

Frozen snapshot of v1 fork (`noamrazbuilds/nanoclaw@8d42685`, tagged `v1-production-snapshot-2026-05-14`) source files containing customizations that need re-implementation in v2.

## Why this exists

Upstream's `/migrate-from-v1` skill explicitly states:

> Source code (`src/*`, `container/agent-runner/src/*`) is NOT portable — v2's architecture is fundamentally different. Stash to `docs/v1-fork-reference/` with a README explaining what each file did. **Don't translate.**

These files exist to be read as **reference**, not copied. Re-implementations land in v2's actual module layout (`src/modules/*`, `src/session-manager.ts`, etc.) — built from spec, not from translation.

## How to use this directory

1. For each preserved customization, write a one-paragraph behavioral spec under `migration-notes/specs/<porter>/<name>.md` using the template in `migration-notes/phase-1-prep.md`.
2. Re-implement the behavior against v2 idioms. Land the new code in `src/` (the live v2 tree), not here.
3. **Never edit files in this directory.** They are a frozen reference; mutation defeats the purpose.

## File index — what each thing is for

### Channels (Porter-Channels — rebase on `upstream/channels`)

| File | What it carries |
|---|---|
| `src/channels/whatsapp.ts` | Baileys integration with inbound sticker handling (lines ~333-346, **U2**), voice-message routing to `transcription.ts` (**U1+CH1**), fork-specific reaction listener (**F6** — inbound reactions emit events into Porter-Features's storage), document send via IPC, group LID normalization. |
| `src/channels/telegram.ts` | Grammy integration with similar customizations: sticker emoji extraction (`[Sticker ${emoji}]`), document handling, reaction listener (**F6**). |
| `src/channels/registry.ts` | Channel self-registration registry pattern. v2 has its own registry — this is reference for understanding intent only. |
| `src/channels/index.ts` | v1 channel barrel. v2's barrel shape is incompatible (Scout §2.2). |
| `src/whatsapp-auth.ts` | Fork's WhatsApp auth flow. Clashes with upstream's `setup/whatsapp-auth.ts` — Phase 1b CH3 resolves. |

### Core (Porter-Core — re-implement against `src/modules/*` and `src/session-manager.ts`)

| File | What it carries |
|---|---|
| `src/index.ts` | Orchestrator. The `runAgent` function (~line 706 in v1) contains the **credit-error fallback wrapper** — detect `isCreditError` on streamed output, swallow message, drop `_close` IPC sentinel, retry once on `gemini-2.5-flash` in isolated slot. **Core spec target C1.** |
| `src/task-scheduler.ts` | Scheduled task runner. After hotfix `8d42685`, it mirrors `runAgent`'s credit-fallback pattern (~line 178). Also contains daily-update pipeline hardening hooks (`suppress_chat_output`, audit trail). **Spec targets C1 + C4.** |
| `src/router.ts` | Message formatting + outbound routing. Daily-update suppression logic may also live here — check before spec extraction. |
| `src/group-queue.ts` | Per-group serialization. Session-lifecycle hook points used by agent drift safeguards (24h rotation, skill-hash invalidation). **Spec target C3.** |
| `src/container-runner.ts` | Container spawn. Reference for OneCLI CA cert handling integration (F4). |
| `src/db.ts` | Single-file SQLite layer. Contains `createTask`/`updateTask` with the `String(prompt)` coercion from hotfix `8d42685` — **DROP per Decision (v2 uses TEXT throughout).** Also contains: `task_audit_log` table schema and write hooks (**C5** — port whole audit subsystem); `reactions` table schema (**F6** — storage half of inbound reactions). Other operations are reference for understanding what v2's `src/db/` needs to support. |
| `src/ipc.ts` | Stdio-frame IPC for sticker/reaction/document send. v2 replaced this entirely with two-SQLite-file model (`inbound.db` + `outbound.db`). Reference for understanding what operations the channels need from v2's outbound vocabulary. |

### Features (Porter-Features — re-host in v2 module layout)

| File | What it carries |
|---|---|
| `src/arena/` (11 files) | Model Arena 5-bot Telegram daily showdown. Uses `getDatabase()` from `src/db.ts` (which disappears in v2) — must re-host DB on a separate `arena.db` or v2 central DB with migrations (Scout §8.3). Keeps `grammy` directly; bypasses channel adapter. **Spec target F1.** |
| `src/oauth-refresh.ts` | SOCKS5 tunnel through Synology NAS to bypass Cloudflare-OAuth refresh block. Network-topology workaround. **Spec target U4 — verify OneCLI obsoletes this before deciding to port.** |
| `container/agent-runner/src/ipc-mcp-stdio.ts` | Fork's custom MCP-stdio bridge. **F5** owns: `register_group`, `host_op`, `pause_task`, `resume_task`, `cancel_task`, `generate_image`. **F6** owns `react_to_message` (split out 2026-05-18 — bundles with the inbound-reactions listener + table). v2's bridge is gone (Bun-based, uses `mcp-tools/core.ts`). Per-tool keep/drop decisions per Scout §3 — recommended 10-min production-log audit to identify dead code. |
| `container/agent-runner/src/index.ts` | Container agent-runner entrypoint. Contains `archiveTranscriptOnExit()` SIGTERM handler (`PreCompact` archive function). **Spec target U6** — port ~30 LOC of SIGTERM markdown archive logic only; v2's per-turn DB writes + SDK `.jsonl` make wholesale crash-safe transcripts redundant. |

### Utils (Porter-Utils — phase 1a blockers + phase 1c finishers)

| File | What it carries |
|---|---|
| `src/transcription.ts` | OpenAI Whisper client + retry logic + language detection. **Phase 1a blocker U1** — channels can't ship until this lands. |
| `src/image.ts` | Inbound image + sticker processing (sharp `.webp→.png`). **Phase 1a blocker U2** — includes the sticker handler for the WhatsApp skill fork. |
| `src/status-tracker.ts` | Per-group UX status surfaced via WhatsApp reaction emojis on user messages. **Phase 1c U3** — **PORT** (Verifier-2 2026-05-18 flipped from "drop"; v2 heartbeat is liveness infra, not per-message UX reactions). Depends on v2's outbound reaction op. |
| `src/host-ops.ts` | Host-side ops invoked by the agent (file mgmt, etc.). **Phase 1c U5c** — likely import-path fixes only. |
| `src/slots.ts` | Slot allocation for concurrent agent runs. **Phase 1c U5a** — likely import-path fixes only. |
| `src/text-styles.ts` | Markdown ↔ channel-native formatting. **Phase 1c U5b** — likely REPLACE with v2's `upstream/skill/channel-formatting` skill (verify overlap at spec extraction). |

## Source-of-truth references

- Strategic plan: `gauntlet-logs/gauntlet-2026-05-14-162241.md` (in the production checkout, `~/NanoClaw/`)
- Reconnaissance: `migration-notes/v2-scout-report.md`
- Locked decisions + Porter sequencing: `migration-notes/phase-1-prep.md`
- Production rollback tag: `v1-production-snapshot-2026-05-14` on `origin/main`
