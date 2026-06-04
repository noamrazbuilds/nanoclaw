# U1-tg — Voice transcription (Telegram fork)

Sub-component of U1 (see `U1.md`). Scope: Telegram adapter voice-message inbound handling. Lands in `noamrazbuilds/nanoclaw-telegram` (`telegram-fork`), not in `nanoclaw-v2`.

- **mechanism:** intent-port

## Source (v1)
- Telegram call site: `docs/v1-fork-reference/src/channels/telegram.ts:341-375` (the v1 async voice handler — gets fileId, downloads via https, calls transcribeAudioBuffer, falls back to placeholder on error).
- No upstream skill commit to cherry-pick — Telegram voice transcription is fork-only.

## Behavioral spec (one paragraph)

When the Telegram adapter's `bot.on('message:voice', ...)` handler receives a voice note, it resolves the chat to `tg:<chat-id>` and looks it up in the registered-groups map. Unregistered chats return the bare placeholder (`[Voice message]`) — no transcription is performed because there's no agent to receive it. For registered chats, the handler downloads the audio buffer via Bot API `getFile` + `https.get` against `api.telegram.org/file/bot<token>/<file_path>`, calls `transcribeAudioBuffer(buffer)` from v2 core, and delivers the transcript (or `FALLBACK_MESSAGE` on null/error) via the adapter's existing `storeMedia(ctx, content)` helper. Reason: Telegram voice notes are first-class user input — without transcription they're dropped by the unprocessable-content path.

## v2 hook point(s)

Working tree: `/home/nanoclaw/nanoclaw-v2-porter-U1-tg` (worktree of `nanoclaw-v2`'s `.git`, branched off `telegram-fork/main`). Branch: `porter-U1-tg`.

- **`src/channels/telegram.ts`** (modified, ~30 LOC):
  - Add `transcribeAudioBuffer`, `FALLBACK_MESSAGE` imports from `'../transcription.js'`.
  - **Replace** the existing bare `bot.on('message:voice', (ctx) => ...)` handler body (line ~312 in `telegram-fork/main`) with an async handler that performs the download + transcribe flow. No new registration; no change to any other handler.
  - Use the file's existing `this.botToken`, the already-imported `https` module, and the existing `storeMedia(ctx, content)` helper. Match the file's existing patterns (e.g. file-url construction at line ~90 in the current fork).

- **`src/transcription.ts`** (new, copy from `nanoclaw-v2/src/transcription.ts` HEAD):
  - Provides `transcribeAudioBuffer` + `FALLBACK_MESSAGE` exports.
  - Required for `telegram-fork`'s standalone build to typecheck the import.

- **`scripts/whisper_transcribe.py`** (new, copy from `nanoclaw-v2/scripts/whisper_transcribe.py`):
  - Same sha256 as v2-migration's copy (`e583462dcd0fe18e5ee141f4f159e7f567b911d2860341fa3959ac5c27ef1710`).

- **`package.json`**: add `openai` dep at `^6.27.0` (transitively required by `transcription.ts`'s dynamic import).

## v2-native equivalent that might suffice?

**DOES-NOT-EXIST.** Verifiable via `git grep -E 'transcribeAudio' telegram-fork/main -- src/channels/telegram.ts` (empty as of 2026-06-03). Upstream has never had Telegram voice support — confirmed by inspecting `upstream/channels` and `telegram` (qwibitai) for any `audioMessage`/`message:voice` voice handling. Fork-only addition matching v1's pattern.

## Verification artifact

- Patch: `migration-notes/patches/U1-tg.patch` — `git diff telegram-fork/main..HEAD` from the porter worktree at commit time.
- Verify script: `scripts/verify-spec-U1-tg.sh` — content/sha-based checks (snippet presence, byte-match of whisper script against production, semantic-equivalence check on transcription.ts via export grep). Does NOT run `pnpm run build` because of F0-6 (pre-existing typecheck failure from `../log.js` import in synced `telegram-pairing.ts`).
- Captured expected output: `migration-notes/verification-outputs/U1-tg.txt`.

## Decisions / open questions

1. **Unregistered-chat early return preserves the bare placeholder.** v1's pattern transcribes only for registered groups (otherwise it would burn local-whisper / OpenAI cycles on chats the agent won't see anyway). Confirmed by reading v1 telegram.ts:344-349.
2. **`storeMedia` vs v1's `storeNonText`.** The fork uses `storeMedia(ctx, content, opts?)` as its uniform inbound-media delivery helper; v1 used a separate `storeNonText(ctx, content)` for non-attachment content. Adapting to the fork's API: call `storeMedia(ctx, transcript ?? FALLBACK_MESSAGE)` with no `opts` arg.
3. **Bot token access:** `this.botToken` is already a private field on the class (set in constructor, line 53). No new env wiring needed.
4. **Mirror v2 core `transcription.ts` into telegram-fork** — same reasoning as U1-wa Decision 1. Self-containedness for the fork's standalone build (when F0-6 is also resolved).

## Notes for Porter

- Pre-flight: `bash scripts/lock-spec.sh U1-tg` must exit 0 before any apply action.
- Working tree: `/home/nanoclaw/nanoclaw-v2-porter-U1-tg` (already created via `scripts/setup-porter-worktree.sh U1-tg --base telegram-fork/main`).
- Apply: copy `transcription.ts` and `whisper_transcribe.py` from v2-migration HEAD; add `openai` dep; `pnpm install`; edit `src/channels/telegram.ts`; commit on `porter-U1-tg`.
- Verify: `bash scripts/verify-spec-U1-tg.sh` must exit 0.
- Pushes: NONE. The work stays on local branch `porter-U1-tg` until cutover.
- Generate patch: `cd /home/nanoclaw/nanoclaw-v2-porter-U1-tg && git diff telegram-fork/main..HEAD > /home/nanoclaw/nanoclaw-v2/migration-notes/patches/U1-tg.patch`.
