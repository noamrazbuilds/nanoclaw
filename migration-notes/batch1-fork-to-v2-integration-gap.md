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
