# CH1 — WhatsApp channel orchestration

## Source (v1)
- v1 fork's WhatsApp adapter: `docs/v1-fork-reference/src/channels/whatsapp.ts` (multi-feature, multi-author file).
- Decomposed scope across leaf specs (CH1 is orchestration, not new behavior):
  - **U1** (voice transcription) — `specs/porter-utils/U1.md`
  - **U2** (image + sticker) — `specs/porter-utils/U2.md`
  - **F6** (inbound reactions) — `specs/porter-features/F6.md`
- Confirmed-upstream (NOT fork delta): LID normalization (`botLidUser`, `setLidPhoneMapping`), `ASSISTANT_HAS_OWN_NUMBER` prefix logic, `isBotMessage` detection — all present in `whatsapp/main`. Verified 2026-05-19 via direct grep against the upstream branch.

## Behavioral spec (one paragraph)
The WhatsApp channel adapter integrates Baileys with v2's channel registry: subscribes to `messages.upsert` for inbound text/media/voice, `messages.reaction` for inbound reactions, plus connection lifecycle events. After CH1's orchestration completes, the merged adapter handles: text messages (upstream-native), voice messages (via U1 — downloads buffer, calls `transcribeAudioBuffer`, replaces content with transcript), image messages (via U2 — downloads, resizes via sharp, writes to attachments, replaces content with `[Image: <path>]`), sticker messages (via U2 fork-delta — downloads .webp, converts to .png, writes to attachments, replaces content with `[Sticker: <path>]`), reactions inbound + outbound (via F6 — `storeReaction` + `sendReaction` + `react_to_message` MCP tool). LID-to-phone translation, bot-vs-user message detection (shared-number prefix vs own-number `fromMe`), and assistant-name mention normalization all come from upstream's `whatsapp/main` base. The reason this row exists separately from U1/U2/F6: it is the **assembly step** — a sequenced merge plan that produces a working channel adapter from upstream skill branches + the fork's deltas, with explicit conflict-resolution guidance.

## v2 hook point(s) — the cherry-pick plan
Work happens in the **WhatsApp fork worktree** (`/home/nanoclaw/nanoclaw-whatsapp-work` on the U1 branch — typically `u1-voice-transcription-wa` or similar, branched off `whatsapp-fork/main`). NOT in `~/nanoclaw-v2` (`v2-migration` branch); that's the host repo where v2 core changes live (transcription.ts helper extraction, etc.). Each skill branch carries 17-25 merge-from-main commits piled on top of 1-2 actual feature commits; **cherry-pick the feature commits, do NOT merge the branches** (would pull in 8K LOC of unrelated drift).

**Sequence (cherry-picks onto whatsapp-fork/main):**
1. **`dfc23a2`** (the feature commit on `whatsapp/skill/image-vision`, U2 image half). Adds `src/image.ts` (byte-identical to v1), call sites in `src/channels/whatsapp.ts`, sharp dep, image-vision SKILL.md. Expected conflict: `container/agent-runner/src/index.ts` (single file). Validate: `npm test src/image.test.ts`, `npm run build`.
2. **`c054cbc`** (the feature commit on `whatsapp/skill/voice-transcription`, U1 OpenAI half). Adds `src/transcription.ts` (OpenAI Whisper), voice handling in `src/channels/whatsapp.ts`, openai dep, `OPENAI_API_KEY` in `.env.example`. Expected conflict: `package-lock.json` (single file; resolve with `--theirs` and `npm install`). Validate: `npm test src/channels/whatsapp.test.ts`, `npm run build`.
3. **`a23e372`** (the feature commit on `whatsapp/skill/reactions`, F6 full coverage + U3 status-tracker bundled). Adds `reactions` table + `storeReaction`/`sendReaction` + listener + `react_to_message` MCP tool + container reactions SKILL.md + `scripts/migrate-reactions.ts` + `status-tracker.ts`. Expected conflict: `container/agent-runner/src/ipc-mcp-stdio.ts` (single file). Run migration: `npx tsx scripts/migrate-reactions.ts`. Validate: `npm test`, `npm run build`.
4. **U1 fork delta — Linux local-whisper backend** (per U1 spec): drop in `scripts/whisper_transcribe.py` from `docs/v1-fork-reference/scripts/whisper_transcribe.py`. Modify `src/transcription.ts` to add the local-first/OpenAI-fallback chain (preserving the fallback string). Also extract `transcribeAudioBuffer(buffer)` helper so Telegram (CH2) can reuse it. **Do NOT cherry-pick `0ccecbd`** (the use-local-whisper skill) — its `whisper-cli` invocation assumes macOS Homebrew; replay the Linux faster-whisper subprocess pattern from v1 instead.
5. **U2 fork delta — sticker handling** (per U2 spec): patch `src/image.ts` with `isStickerMessage`, `processSticker`, `STICKER_REF_PATTERN`, parseImageReferences extension. Patch `src/channels/whatsapp.ts` with the inbound sticker download/process branch (mirror v1 lines 333-346). Final test: send a sticker in a test chat → verify it lands as `[Sticker: attachments/sticker-*.png]`.

**Cherry-pick conflict resolution:** Each cherry-pick has exactly one expected conflict file (verified 2026-06-02 via `git merge-tree` against `whatsapp-fork/main`). Resolution pattern per file:
- `package-lock.json` (c054cbc): `git checkout --theirs package-lock.json && npm install && git add package-lock.json && git cherry-pick --continue`.
- `container/agent-runner/src/index.ts` (dfc23a2): read both sides; the cherry-pick side is canonical for image-vision call sites.
- `container/agent-runner/src/ipc-mcp-stdio.ts` (a23e372): read both sides; the cherry-pick side is canonical for `react_to_message`; preserve any other MCP tools the cherry-pick doesn't touch.
If a cherry-pick produces conflicts beyond the expected file(s), STOP — the skill branches have drifted since 2026-06-02 audit. Fall back to the U1/U2/F6 specs' explicit fork-delta lists.

## v2-native equivalent that might suffice?
**EXISTS-NATIVELY (via skill branches) for ~90% of CH1.** All three skills exist upstream. Fork deltas: Linux local-whisper backend (~30 LOC, U1) + sticker patch (~35 LOC, U2). LID/prefix/bot-detection: 100% native. Total fork-specific work: <100 LOC across two files.

## Decisions / open questions
1. **Cherry-pick order**: image-vision (`dfc23a2`) → voice-transcription (`c054cbc`) → reactions (`a23e372`). Image-vision first because it adds the smallest `src/channels/whatsapp.ts` diff (one new branch in `messages.upsert`); voice-transcription second because it touches the same handler but doesn't conflict with image; reactions last because it touches the most files (db.ts, channels/whatsapp.ts, types.ts, ipc.ts, index.ts, group-queue.ts, ipc-mcp-stdio.ts). Order can swap, but this minimizes per-step conflicts.
2. **Feature-commit hash pinning vs always-latest**: cherry-pick the **specific feature commits** identified by the 2026-06-02 audit (`dfc23a2`, `c054cbc`, `a23e372`). Re-verify the commits still exist before running (`git log --oneline whatsapp/skill/voice-transcription -- ':!**'`). If new feature commits have landed on the skill branches since 2026-06-02, audit them and decide whether to cherry-pick those too (don't blindly take HEAD — the merge-from-main noise is what burned the original spec).
3. **CH2 (Telegram) sequencing**: CH2 is independent — different fork repo, different message protocol. Can be done before/after/parallel to CH1. No deps either direction.
4. **CH3 dependency on CH1**: CH3 resolves `whatsapp-auth.ts` clash (fork has it in `src/`, upstream in `setup/`). CH3 should run AFTER CH1's cherry-picks complete so the working set is current. Sequencing: CH1 → CH3.

## Notes for Porter
- **No pushes during Phase 2.** Cherry-picks land on `whatsapp-fork/main`'s local branch in the WA fork worktree. The decision to push to `whatsapp-fork` (user's GitHub fork of nanoclaw-whatsapp) is deferred to Phase 4/5 cutover. Per [[feedback_push_target]] when pushes do happen, target `whatsapp-fork` (user's fork), NOT `whatsapp` (upstream).
- **Install-wiring deferred.** Today `/add-whatsapp` runs `git fetch origin channels` (no `channels` branch exists in `noamrazbuilds/nanoclaw`; only `upstream/channels` does). Phase 4/5 work decides whether to (a) sync the merged WA fork content into `noamrazbuilds/nanoclaw`'s `channels` branch, or (b) update the SKILL.md to fetch from `whatsapp-fork` directly. Not in CH1 scope.
- **Skill branch URL gotcha**: the SKILL.md files in each skill branch tell users to add a `whatsapp` remote pointing at `https://github.com/qwibitai/nanoclaw-whatsapp.git`. The worktree already has both `whatsapp` (upstream) AND `whatsapp-fork` (user fork) remotes — verify both still exist (`git remote -v`) before starting.
- **After all cherry-picks, run the full test suite**: `npm test && npm run build` inside the WA fork worktree.
- **Smoke-test in a real registered chat** post-cherry-pick: send text, image, sticker, voice note, and a reaction. Verify each lands as the right content marker.
- **The skill branches may have drifted since 2026-06-02 audit** — if any expected-conflict claim turns out wrong (more than one file conflicts per cherry-pick), STOP and fall back to the U1/U2/F6 specs' explicit fork-delta lists.
