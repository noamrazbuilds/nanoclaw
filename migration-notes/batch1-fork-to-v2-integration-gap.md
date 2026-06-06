# Batch-1 finding: the WhatsApp fork→v2 adapter integration is missing (2026-06-04)

Surfaced while porting F6 (reactions); audited across U1/U2 per Noam's request. **This is bigger than any single feature row** and should be resolved before more Batch-1 channel rows are ported.

## The claim

The `/add-whatsapp` skill copies the fork's `src/channels/whatsapp.ts` verbatim into a v2 install (`git show whatsapp-fork/main:src/channels/whatsapp.ts > src/channels/whatsapp.ts`, then `pnpm run build`). **That build cannot succeed** — the fork's `whatsapp.ts` is a **v1-architecture adapter** and v2 does not provide the modules/registry it imports.

## Evidence (all re-runnable on `v2-migration`)

The fork's `whatsapp.ts` imports (`git show whatsapp-fork/main:src/channels/whatsapp.ts | grep "from '\.\./\|from './registry"`):
- `from '../db.js'` — **v2 has no `src/db.ts`** (`ls src/db.ts` → not found). v2's DB layer is `src/db/` (modular, central + session split).
- `from '../logger.js'` — **v2 has no `src/logger.ts`** (v2 uses `src/log.ts`).
- `from './registry.js'` with `registerChannel(...)` + `class WhatsAppChannel implements Channel` — **v2 has no v1 `registerChannel`**. v2's registry is `src/channels/channel-registry.ts` exporting `registerChannelAdapter(name, ChannelRegistration)` — a different API and a different `Channel`/adapter shape (`src/channels/adapter.ts`, `chat-sdk-bridge.ts`).
- `from '../config.js'` (ASSISTANT_NAME, ASSISTANT_HAS_OWN_NUMBER, STORE_DIR) — ✅ v2 `src/config.ts` does export these.
- `from '../types.js'` — ✅ present, but v2's `Channel` interface differs from the fork's v1 `Channel`.

The skill (`.claude/skills/add-whatsapp/SKILL.md` steps 2–6) does a raw fetch + `import './whatsapp.js'` append + `pnpm run build`. No sed/transform, no compat shim, and it does **not** fetch `db.ts`/`logger.ts`/`registry.js`.

## Why U1/U2/F6 didn't catch it

All three rows' verify scripts (`verify-spec-U1-wa.sh`, `verify-spec-U2.sh`, `verify-spec-F6.sh`) check the **fork worktree** (`/home/nanoclaw/nanoclaw-v2-porter-*`), which is a complete v1-lineage repo *with* `db.ts`/`logger.ts`/`registry.js` — so the ports typecheck there. The break only exists in a **v2 install**, which none of the verify scripts exercise. The feature ports themselves are faithful and correct; the gap is the absent fork→v2 adapter-integration layer, which predates all of them.

## Implication for the plan

"Port features into the fork, fetch into v2 via `/add-whatsapp`" is missing a load-bearing step: **a v2-native WhatsApp adapter**. Options (need Noam's call):

1. **Port the WhatsApp adapter to v2's channel architecture** — rewrite `whatsapp.ts` against `registerChannelAdapter`/`ChannelRegistration`, wire it to v2's `src/db/` session model and `src/delivery.ts`, drop the v1 `registry.js`/`logger.js`/file-IPC assumptions. The feature rows (voice/image/reactions) then re-target this v2 adapter instead of the fork's v1 one. Largest effort; the only path that actually ships these features in v2.
2. **Provide a v1-compat shim in v2** (`src/db.ts`, `src/logger.ts`, a `registerChannel` bridge over `registerChannelAdapter`) so the fork's v1 adapter drops in unmodified. Faster, but bolts a second channel architecture onto v2 permanently.
3. **Keep the fork as the runtime** for WhatsApp and have v2 bridge to it out-of-process. Largest architecture change; probably not intended.

Until one is chosen, U1/U2/F6 (and any further WhatsApp channel rows, e.g. CH1/CH3) are **fork-internal deliverables that do not yet ship to v2**. The ports are sound and worth keeping; they just sit behind this integration gap.

## Status of committed rows

- U1 (voice), U2 (image), F6 (reactions): faithfully ported + verified **in the fork**; committed on local `porter-*` branches; patches captured under `migration-notes/patches/`. None pushed to fork `main`. No current v2 install is affected (the skill fetches `whatsapp-fork/main`, which lacks the ports, and the build was already broken independently).

---

## Resolution (2026-06-04): adopt upstream's v2-native adapter; re-target deltas

Decided with Noam after confirming a v2-native Baileys adapter already exists upstream. Chosen over the v1-compat shim and over writing a v2 adapter from scratch.

### Root cause
There are **two unrelated `whatsapp.ts`**:
- `upstream/channels:src/channels/whatsapp.ts` — the **v2-native** Baileys adapter (910 lines; `registerChannelAdapter`, `../config.js`, `../log.js`, `./channel-registry.js`). Already contains image/reaction/voice scaffolding (`grep -ciE` → image 4, reaction 3, voice 1).
- `whatsapp-fork/main` (fork of `qwibitai/nanoclaw-whatsapp`) — a **v1-lineage standalone app** (`registerChannel`, `../db.js`, `../logger.js`, file-IPC, its own `index.ts`/`ipc.ts`/`container/agent-runner`).

The Phase-0 install-wiring fix saw `origin/channels` missing (true — `noamrazbuilds/nanoclaw` has no `channels` branch: `git ls-remote --heads origin | grep channels` → empty) and repointed `/add-whatsapp` at `whatsapp-fork/main` (the v1 standalone) instead of seeding a `channels` branch with the v2 adapter. That is the defect.

### Plan
1. Seed `origin/channels` on `noamrazbuilds/nanoclaw` from `upstream/channels` — the v2 adapter's proper home; fixes the missing-branch root cause.
2. **Per-feature gap analysis** of each WhatsApp feature row against the v2 adapter (results appended below). Rows that the v2 adapter already covers collapse to no-ops or small deltas.
3. Re-target only the genuine deltas onto the v2 adapter, using the existing U1/U2/F6/CH* specs + patches as the **behavioral intent source** (not as v2 code).
4. Repoint `.claude/skills/add-whatsapp/SKILL.md` at `origin/channels`; `pnpm run build` must pass on a fresh v2 checkout.

### Why not the v1-compat shim
The fork's v1 adapter needs more than `src/db.ts` + `src/logger.ts`: it assumes the v1 file-IPC watcher, the v1 session/DB model, the `registerChannel` registry, and the v1 `container/agent-runner` (`ipc-mcp-stdio.ts`). A shim would rebuild v1 inside v2 and saddle the codebase with two channel architectures permanently — to avoid re-applying a handful of small deltas onto an adapter that already exists.

### Status of the fork-port artifacts
U1/U2/F6 fork ports stay committed on their local `porter-*` branches as **behavioral reference**; they are NOT v2 deliverables and must NOT be pushed to fork `main`. The Batch-1 mechanism changes from "port into the v1 fork" to "re-target deltas onto `origin/channels` (v2 adapter)."

### Gap analysis (per feature, vs `upstream/channels:src/channels/whatsapp.ts` + v2 infra)

Run 2026-06-04 (three independent read-only passes). Headline: **the v2 adapter + v2 core already cover most of Batch 1.** The committed fork patches (`U1-wa.patch`, `U2.patch`, `F6.patch`) should **NOT** be applied to v2 — they target the old class-based fork adapter and v1's file-IPC/`store/messages.db` model. Re-target only the genuine deltas below.

| Feature | v2 coverage | Real remaining delta | Apply the fork patch? |
|---|---|---|---|
| **U1 voice** | ✅ **DONE** (`origin/channels` @ `86646b5`, 2026-06-05) — U1-core already in v2 (commit `9af8666`); the ~26-LOC adapter hook (transcribe `ptt`, skip its attachment) re-targeted onto the v2-native adapter. Text-only decision. Validated by typecheck. | done | No (targeted old class adapter) |
| **U2 image** | ✅ already native — no work needed (full-res; resize deferred unless token cost bites). | none | No |
| **U2 sticker** | ✅ **DONE** (`origin/channels` @ `a167d33`, 2026-06-05) — added `stickerMessage` (.webp) to `downloadInboundMedia` (3 LOC). Minimal: no sharp, no conversion (Claude vision takes WebP). Validated by typecheck. | done | No |
| **F6 reactions — outbound** | **EXISTS-NATIVELY ~100%** — `add_reaction` MCP tool (`container/agent-runner/src/mcp-tools/core.ts:222-263`), `getMessageIdBySeq` (`db/messages-out.ts:90-113`, resolves inbound ids too), delivery passthrough (`src/delivery.ts:356-363`), adapter `operation:'reaction'` branch (`whatsapp.ts:817-829`). Works across all channels, cleaner than v1. | **none** | No — would duplicate `add_reaction` |
| **F6 reactions — inbound** | ✅ **DONE** (core on `v2-migration`; adapter on `origin/channels` @ `f1070f4`, 2026-06-05) — **Option A** (gauntlet-decided): `reactions` table in the session **`inbound.db`** (NOT central `v2.db` — the container only mounts its session DBs), `onReaction` callback on `ChannelSetup`, `routeReaction` (no wake, no session spawn, per-agent-namespaced ids), `messages.reaction` listener. Minimal queryable table; inline-surfacing deferred. Validated: 325/325 host tests + typecheck. | done | No (built on v2 arch) |

**Per-feature notes worth keeping:**
- **U1:** config is identical to v1 (local faster-whisper, model `base`, `WHISPER_MODEL`/`WHISPER_PYTHON` overrides, 60s timeout → OpenAI `whisper-1` fallback → `[Voice Message - transcription unavailable]`). Decision for Noam: in v2 a voice note already downloads as an `.ogg` attachment, so after adding the transcript hook the agent gets transcript **and** the audio file; optionally skip the audio download when `ptt === true` to keep voice-as-text-only like v1.
- **U2:** correction to the U2 spec — **neither v1 nor v2 injects base64 vision blocks**; both surface attachments as a file-path marker the agent opens with its Read tool (`container/agent-runner/src/providers/claude.ts:72,88` is string-only). So dropping `src/image.ts`/`parseImageReferences` loses no vision capability. Keep v2's `isSafeAttachmentName` traversal guard. v2 paths are session-scoped (`DATA_DIR/attachments`), not v1's `GROUPS_DIR/<folder>/attachments` — use v2's.
- **F6:** `reactToLatestMessage` ("react to latest, no `messageId`") has no v2 equivalent — `add_reaction` requires a `messageId`. Add only if Noam wants it; not required for core reactions. The four `getReactions*` read paths have 0 call sites — port only `storeReaction` unless a consumer skill is in scope.

**Revised Batch-1 effort:** far smaller than the fork-port track implied. U1 ≈ 15 LOC, U2 ≈ 1–25 LOC, F6 ≈ inbound-only ~100 LOC (outbound free). The expensive shared pieces (transcription core, image download/persist, the entire outbound-reaction pipeline) are already done in v2.

### ✅ Batch 1 COMPLETE (2026-06-06)

All Batch-1 WhatsApp rows are re-targeted onto the v2-native adapter and verified:

| Row | Status | Where |
|-----|--------|-------|
| U1 voice | ✅ | `origin/channels` @ `86646b5` |
| U2 image/sticker | ✅ | `origin/channels` @ `a167d33` |
| F6 reactions (in+out) | ✅ | core on `v2-migration` (`054a45e`) + adapter `origin/channels` @ `f1070f4` |
| CH1 orchestration | ✅ | assembled adapter; closeout below |
| CH3 whatsapp-auth | ✅ | upstream version canonical (verification only) |

**CH1 closeout (deferred Phase-0 exit criterion):** clean `/add-whatsapp` into a fresh `v2-migration` checkout + full `pnpm run build` → **exit 0**; `dist/channels/whatsapp.js` contains all three feature paths (`messages.reaction`, `transcribeAudioBuffer`, `stickerMessage`). The whole assembled adapter compiles in a real v2 install. Host suite: **325/325 pass**.

**Not yet done (cutover-time):** live smoke-test in a registered chat (text/image/sticker/voice note/reaction round-trip); and the optional reactions "consumption" affordance (inline-surfacing or a `get_reactions` read tool — F6 open item). `origin/channels` is NOT yet merged into the fork's `main` (it stays on the `channels` branch, consumed by `/add-whatsapp`).

