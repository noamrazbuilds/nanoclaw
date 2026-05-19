# CH2 — Telegram channel orchestration

## Source (v1)
- v1 fork's Telegram adapter: `docs/v1-fork-reference/src/channels/telegram.ts` (437 LOC).
- Key handlers: photo (lines 298-339, downloads), voice (341-378, downloads + transcribes), document (380+, downloads), audio/video/sticker/location/contact (placeholders).
- Helpers: `storeNonText(ctx, placeholder)` — fork's content-only writer (line 265).
- Imports: `transcribeAudioBuffer` from `../transcription.js` (U1 cross-channel dependency); NO import of `image.ts` (Telegram path doesn't use sharp resize).
- Cross-row dependencies: U1 (voice transcription helper). NOT U2 (Telegram photo handling is independent of WhatsApp's sharp-resize pipeline).
- Confirmed during F6 audit: **v1 has NO Telegram reaction listener** — only sticker emoji extraction into `[Sticker emoji]` content (same as upstream).

## Behavioral spec (one paragraph)
The Telegram channel adapter integrates grammY with v2's channel registry: subscribes to `message:*` events for inbound media, plus standard `message` / `edited_message` for text. After CH2's orchestration completes, the merged adapter handles: text (upstream-native), photo (downloads via Bot API `getFile` + https fetch → writes `attachments/photo_<msgid>.jpg` → content `[Photo: attachments/<name> (<KB>KB)]`), voice (downloads buffer → calls `transcribeAudioBuffer` from U1 → content `[Voice: <transcript>]` or fallback `[Voice message - transcription unavailable]`), document (downloads → writes `attachments/<original-filename>` → content `[Document: <name> (<KB>KB)]`), sticker (emoji extraction → content `[Sticker <emoji>]`, no image download — matches upstream), audio/video/location/contact (placeholders only). The reason for divergence from upstream: v1 fork inlines media-download-and-process at receive time so the agent gets concrete file paths immediately; upstream defers via `storeMedia(ctx, placeholder, attachment_metadata)` for later resolution. Both reach the agent eventually; v1's path is simpler and works in v2 unchanged. **No Telegram reactions** — out of scope (production data shows no Telegram reaction usage; the v1 fork doesn't have it either).

## v2 hook point(s) — the merge plan
Work happens in the main nanoclaw worktree (`~/nanoclaw-v2` on `v2-migration` branch), merging from the `telegram-fork`/`telegram` remotes.

**Major architectural divergence from upstream**: NO skill branches exist on the Telegram remote (only `main`). Compare to WhatsApp which has `skill/voice-transcription`, `skill/image-vision`, `skill/reactions`. Telegram features are fork-only patches, not skill-branched. This means CH2 is NOT a skill-merge-driven assembly like CH1 — it's a direct port of v1 fork's `src/channels/telegram.ts` deltas onto upstream's base.

**Sequence:**
1. **Verify upstream Telegram channel skill is applied** (presumably already via `whatsapp/main`'s setup — confirm `src/channels/telegram.ts` exists in the worktree). If not, run `.claude/skills/add-telegram/SKILL.md` setup first.
2. **U1 prerequisite**: `transcribeAudioBuffer` helper must exist in `src/transcription.ts` (CH1 step 4 places it there). CH2 depends on CH1's U1 fork-delta landing first.
3. **Port v1 telegram.ts deltas** onto upstream's `src/channels/telegram.ts`:
   - Replace upstream's `storeMedia` calls with v1's `storeNonText` helper (or keep `storeMedia` and add metadata path — see OQ#1).
   - Photo handler: replace placeholder-only with download-and-write inline (v1 lines 298-339, ~40 LOC).
   - Voice handler: replace placeholder-only with download + `transcribeAudioBuffer` + content marker (v1 lines 341-378, ~38 LOC).
   - Document handler: replace placeholder-only with download-to-attachments (v1 lines 380-436, ~55 LOC).
   - Sticker handler: byte-identical to upstream (already correct); no change needed.
4. **Token + auth flow**: upstream handles bot-token via env / OneCLI vault. v1's `botToken` reference (line 353) should resolve to the same. Verify no schema change needed.
5. **Validate**: `npm test src/channels/telegram.test.ts` (if tests exist), `npm run build`. Smoke-test in a real registered chat: text, photo, voice note, document, sticker.

## v2-native equivalent that might suffice?
**PARTIAL-OVERLAP.** Upstream `telegram/main` has all the event handlers (photo, voice, document, etc.) but emits placeholder-only content with attachment metadata for deferred resolution. The fork inlines download + processing. Net fork delta: ~133 LOC across three handlers (photo + voice + document) plus the storeNonText helper. Sticker handling is byte-identical; no fork delta.

## Decisions / open questions
1. **storeMedia (upstream) vs storeNonText (fork) helper pattern**: keep v1's inline-download (simpler port, deterministic content markers, immediate file paths) OR refactor to upstream's deferred-resolution (cleaner separation, but requires understanding v2's attachment-resolution pipeline downstream). **Recommend keep v1's pattern** — port verbatim, defer the refactor to upstream-contribution-prep phase 5 if/when contributing the voice-transcription delta back.
2. **Photo size limit**: v1 has no size cap (writes raw Telegram photo, typically <10MB). WhatsApp's U2 caps at 1024px via sharp resize. Should CH2 add a resize step for consistency? **Recommend NO for now** — Telegram already provides multiple resolutions (v1 picks the highest, `photos[photos.length-1]`); the actual image is rarely huge. Add resize if disk consumption becomes a real problem.
3. **Document name sanitization**: v1's doc handler uses Telegram's reported filename. Per `feedback_action_guardrails` and general path-injection caution, the name should be sanitized (no path separators, length cap). Worth a small hardening pass during port. **Recommend: add sanitization** — `isSafeAttachmentName` (v2 already has it at `src/attachment-safety.ts`) can be reused.
4. **Future Telegram skill branches**: per [[project_upstream_contribution_prep]], the voice transcription + document download patterns are upstreamable. Phase 5 work: extract these as `telegram-fork/skill/voice-transcription` and `telegram-fork/skill/documents` branches and PR to qwibitai. NOT in CH2 scope; just flagged here.

## Notes for Porter
- **No skill-merge sequence for CH2** (unlike CH1) — it's a direct file-level port of v1's deltas onto upstream's base.
- **U1's `transcribeAudioBuffer` is the critical dependency** — Telegram voice handler imports it. CH1's step 4 places this in `src/transcription.ts` for cross-channel use. If CH2 runs before CH1, this import will fail. Sequence: **CH1 → CH2** (or interleave — apply CH1's U1 delta before CH2's voice handler port).
- **botToken handling**: v1 reads `this.botToken` (instance field, set at construction from env). Verify upstream's pattern matches; if it uses OneCLI vault for the token, adapt the URL construction in `https.get(...)` calls.
- **Push target**: `origin` on the main nanoclaw fork. The telegram-fork remote is for the channel-skill repo specifically; the actual src/channels/telegram.ts changes commit to the main repo.
- **Smoke-test specifics**: send a photo (verify download), a voice note (verify transcript), a document (verify attachments/<name>), a sticker (verify `[Sticker emoji]`), text with @mention (verify trigger pattern matches).
- **The byte-identical sticker handler is verified 2026-05-19**: v1 line 438-441 = upstream line 332-334 (same emoji extraction, same content format). No regression risk.
