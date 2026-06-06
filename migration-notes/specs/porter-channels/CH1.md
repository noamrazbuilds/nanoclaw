# CH1 — WhatsApp channel orchestration

> **✅ DONE (2026-06-06).** The merge-skill-branches plan below is superseded by the re-target-onto-v2-adapter mechanism (`migration-notes/batch1-fork-to-v2-integration-gap.md`). CH1's outcome — a working v2 WhatsApp adapter assembling U1 (voice), U2 (image/sticker), F6 (reactions) on top of upstream-native text/LID/prefix/bot-detection — is achieved on `origin/channels` (@ `f1070f4`) + v2 core. **Closeout verification (the deferred Phase-0 exit criterion):** a clean `/add-whatsapp` into a fresh `v2-migration` checkout (fetch adapter+auth+groups from `origin/channels`, wire the barrel, install pinned deps `@whiskeysockets/baileys@7.0.0-rc.9 qrcode@1.5.4 @types/qrcode@1.5.6 pino@9.6.0`) + full `pnpm run build` → **exit 0**, and `dist/channels/whatsapp.js` contains all three feature paths (`messages.reaction`, `transcribeAudioBuffer`, `stickerMessage`). Native LID/prefix/bot-detection confirmed in the upstream base. Remaining (not blocking): live smoke-test in a registered chat (text/image/sticker/voice/reaction) at cutover. Sections below are the superseded merge plan.

## Source (v1)
- v1 fork's WhatsApp adapter: `docs/v1-fork-reference/src/channels/whatsapp.ts` (multi-feature, multi-author file).
- Decomposed scope across leaf specs (CH1 is orchestration, not new behavior):
  - **U1** (voice transcription) — `specs/porter-utils/U1.md`
  - **U2** (image + sticker) — `specs/porter-utils/U2.md`
  - **F6** (inbound reactions) — `specs/porter-features/F6.md`
- Confirmed-upstream (NOT fork delta): LID normalization (`botLidUser`, `setLidPhoneMapping`), `ASSISTANT_HAS_OWN_NUMBER` prefix logic, `isBotMessage` detection — all present in `whatsapp/main`. Verified 2026-05-19 via direct grep against the upstream branch.

## Behavioral spec (one paragraph)
The WhatsApp channel adapter integrates Baileys with v2's channel registry: subscribes to `messages.upsert` for inbound text/media/voice, `messages.reaction` for inbound reactions, plus connection lifecycle events. After CH1's orchestration completes, the merged adapter handles: text messages (upstream-native), voice messages (via U1 — downloads buffer, calls `transcribeAudioBuffer`, replaces content with transcript), image messages (via U2 — downloads, resizes via sharp, writes to attachments, replaces content with `[Image: <path>]`), sticker messages (via U2 fork-delta — downloads .webp, converts to .png, writes to attachments, replaces content with `[Sticker: <path>]`), reactions inbound + outbound (via F6 — `storeReaction` + `sendReaction` + `react_to_message` MCP tool). LID-to-phone translation, bot-vs-user message detection (shared-number prefix vs own-number `fromMe`), and assistant-name mention normalization all come from upstream's `whatsapp/main` base. The reason this row exists separately from U1/U2/F6: it is the **assembly step** — a sequenced merge plan that produces a working channel adapter from upstream skill branches + the fork's deltas, with explicit conflict-resolution guidance.

## v2 hook point(s) — the merge plan
Work happens in the main nanoclaw worktree (`~/nanoclaw-v2` on `v2-migration` branch); skill branches live on the `whatsapp-fork` (and `whatsapp` upstream) remote and merge into the worktree's main branch.

**Sequence:**
1. **`whatsapp/skill/image-vision`** (U2 image half). Merges `src/image.ts` (byte-identical to v1), call sites in `src/channels/whatsapp.ts`, sharp dep, image-vision SKILL.md. Validate: `npm test src/image.test.ts`, `npm run build`.
2. **`whatsapp/skill/voice-transcription`** (U1 OpenAI half). Merges `src/transcription.ts` (OpenAI Whisper), voice handling in `src/channels/whatsapp.ts`, openai dep, OPENAI_API_KEY in .env.example. Validate: `npm test src/channels/whatsapp.test.ts`, `npm run build`.
3. **`whatsapp/skill/reactions`** (F6 full coverage + U3 status-tracker bundled). Merges `reactions` table + `storeReaction`/`sendReaction` + listener + `react_to_message` MCP tool + container reactions SKILL.md + `scripts/migrate-reactions.ts` + `status-tracker.ts`. Run migration: `npx tsx scripts/migrate-reactions.ts`. Validate: `npm test`, `npm run build`.
4. **U1 fork delta — Linux local-whisper backend** (per U1 spec): drop in `scripts/whisper_transcribe.py` from `docs/v1-fork-reference/scripts/whisper_transcribe.py`. Modify `src/transcription.ts` to add the local-first/OpenAI-fallback chain (preserving the fallback string). Also extract `transcribeAudioBuffer(buffer)` helper so Telegram (CH2) can reuse it. **Skip the upstream `use-local-whisper` skill merge** — it assumes macOS Homebrew; not applicable for the Linux production server.
5. **U2 fork delta — sticker handling** (per U2 spec): patch `src/image.ts` with `isStickerMessage`, `processSticker`, `STICKER_REF_PATTERN`, parseImageReferences extension. Patch `src/channels/whatsapp.ts` with the inbound sticker download/process branch (mirror v1 lines 333-346). Final test: send a sticker in a test chat → verify it lands as `[Sticker: attachments/sticker-*.png]`.

**Merge conflict resolution:** Each skill's SKILL.md instructions cover the common conflict on `package-lock.json` (`git checkout --theirs package-lock.json && git add && git merge --continue`). For src/* conflicts, read both sides; the upstream skill side is canonical for the skill's surface; the fork-delta side is canonical for the U1/U2 patches.

## v2-native equivalent that might suffice?
**EXISTS-NATIVELY (via skill branches) for ~90% of CH1.** All three skills exist upstream. Fork deltas: Linux local-whisper backend (~30 LOC, U1) + sticker patch (~35 LOC, U2). LID/prefix/bot-detection: 100% native. Total fork-specific work: <100 LOC across two files.

## Decisions / open questions
1. **Skill merge order**: proposed order is image-vision → voice-transcription → reactions. Image-vision first because it adds the smallest src/channels/whatsapp.ts diff (one new branch in `messages.upsert`); voice-transcription second because it touches the same handler but doesn't conflict; reactions last because it touches the most files (db.ts, channels/whatsapp.ts, types.ts, ipc.ts, index.ts, group-queue.ts, ipc-mcp-stdio.ts). Order can swap, but this minimizes per-step conflicts.
2. **Skill branch HEAD pinning vs always-latest**: merge whichever HEAD is current at execution time, OR pin to specific commit hashes for reproducibility? Recommend **HEAD at execution time** — these are user-maintained skill branches, current state is canonical. Pin only if a regression appears later.
3. **CH2 (Telegram) sequencing**: CH2 is independent — different fork repo, different message protocol. Can be done before/after/parallel to CH1. No deps either direction.
4. **CH3 dependency on CH1**: CH3 resolves `whatsapp-auth.ts` clash (fork has it in `src/`, upstream in `setup/`). CH3 should run AFTER CH1's merges complete so the working set is current. Sequencing: CH1 → CH3.

## Notes for Porter
- **Skill branch URL gotcha**: the SKILL.md files in each skill branch tell users to add a `whatsapp` remote pointing at `https://github.com/qwibitai/nanoclaw-whatsapp.git`. The worktree already has both `whatsapp` (upstream) AND `whatsapp-fork` (user fork) remotes — verify both still exist (`git remote -v`) before starting.
- **Push target**: when committing the merged result, push to `origin` (user's main nanoclaw fork), NOT to `whatsapp` (upstream). Per [[feedback_push_target]].
- **After all merges, run the full test suite**: `npm test && npm run build`. Skill branches have their own tests that should all pass.
- **Smoke-test in a real registered chat** post-merge: send text, image, sticker, voice note, and a reaction. Verify each lands as the right content marker.
- **The skill branches may have drifted since 2026-05-19 audit** — if any byte-identical claim turns out wrong, fall back to the U1/U2/F6 specs' explicit fork-delta lists.
