# U1-core — Voice transcription helper (v2 core)

> **✅ DONE (`v2-migration` @ `9af8666`).** Added the channel-agnostic `transcribeAudioBuffer` helper + whisper script to v2 core; the WhatsApp (`c340084`/U1-wa) and Telegram (`1e07c3c`/U1-TG) adapters call it. The adapter-side deltas are re-targeted onto the v2-native adapter on `origin/channels` (`86646b5`). Original spec below.

Sub-component of U1 (see `U1.md` for overview). Scope: the channel-agnostic helper and backend script that live in v2 core. WhatsApp and Telegram fork work are separately tracked as U1-wa and U1-tg.

- **mechanism:** intent-port

The v2 core piece is a pure addition (no v2-side file conflicts possible). v1's `transcribeAudioBuffer` is already channel-agnostic; the intent-port preserves its body verbatim while removing the two WhatsApp-bound exports (`transcribeAudioMessage`, `isVoiceMessage`) that belong in the WhatsApp adapter, not v2 core.

## Source (v1)
- `docs/v1-fork-reference/src/transcription.ts` (132 LOC). Lines 22, 24-51, 53-83, 89-97 contain the channel-agnostic surface that gets preserved (FALLBACK_MESSAGE, transcribeWithLocalWhisper, transcribeWithOpenAI, transcribeAudioBuffer). Lines 99-128, 130-132 contain the WhatsApp-bound exports that are NOT ported here.
- `/home/nanoclaw/NanoClaw/scripts/whisper_transcribe.py` (production, READ-ONLY for copy).

## Behavioral spec (one paragraph)

`src/transcription.ts:transcribeAudioBuffer(buffer: Buffer): Promise<string|null>` tries local faster-whisper first (subprocess to `scripts/whisper_transcribe.py`, 60s timeout, `WHISPER_PYTHON` override allowed, `WHISPER_MODEL` env propagated); on null/error it falls back to the OpenAI Whisper API (`whisper-1`, `response_format: 'text'`, key read via `readEnvFile(['OPENAI_API_KEY'])`); on full failure (both paths fail) returns the constant `FALLBACK_MESSAGE = '[Voice Message - transcription unavailable]'`. Pure host-side; nothing crosses the container boundary. Reason: zero-cost path when local works, reliable fallback when it doesn't, shared surface that the WhatsApp + Telegram adapters call.

## v2 hook point(s)
- New file: `src/transcription.ts` (≈ 100 LOC). Exports: `transcribeAudioBuffer`, `FALLBACK_MESSAGE`.
- New file: `scripts/whisper_transcribe.py` (verbatim copy from `/home/nanoclaw/NanoClaw/scripts/whisper_transcribe.py`).
- New file: `src/transcription.test.ts` — unit test mocking `child_process.execFile` and `import('openai')`. Asserts the three branches: local success, local failure → OpenAI success, both fail → FALLBACK_MESSAGE.

## v2-native equivalent that might suffice?

**DOES-NOT-EXIST.** Confirmable via `git grep 'transcribeAudio' upstream/main` (empty as of 2026-06-03). v2 core has `src/env.ts:readEnvFile` (verified — same API as v1). No transcription helper. This sub-component is purely additive.

## Verification artifact

- Patch: `migration-notes/patches/U1-core.patch` — generated from `git diff HEAD` after applying the changes in `~/nanoclaw-v2`. Captures `src/transcription.ts`, `scripts/whisper_transcribe.py`, `src/transcription.test.ts`.
- Verify script: `scripts/verify-spec-U1-core.sh` — runs `pnpm run build` + `pnpm exec vitest run src/transcription.test.ts`. Both must exit 0.
- Captured expected output: `migration-notes/verification-outputs/U1-core.txt` — first-successful-run capture for Porter re-validation.

## Decisions / open questions

1. **WhatsApp-bound exports removed from v2 core.** v1's `transcribeAudioMessage(msg, sock)` is Baileys-typed and v1's `isVoiceMessage(msg)` checks `msg.message?.audioMessage?.ptt`. Both are channel-specific and stay in the WhatsApp adapter (U1-wa scope). Confirmed by reading v1 source at the line ranges cited under Source.
2. **Local-whisper backend stays as faster-whisper Python.** See U1.md decision 1.
3. **Test isolation:** the unit test mocks `child_process.execFile` and dynamic-imports `openai` so the test does not require the Python subprocess or a real OpenAI key. Verified pattern is consistent with the project's vitest convention (no test crosses the network).

## Notes for Porter

- Pre-flight: `bash scripts/lock-spec.sh U1-core` must exit 0 before any apply action.
- Working tree: current `~/nanoclaw-v2` (branch `v2-migration` or a derived porter branch via `scripts/setup-porter-worktree.sh U1-core`).
- Apply: write the three new files. Generate the patch artifact via `git diff HEAD > migration-notes/patches/U1-core.patch` before commit.
- Verify: `bash scripts/verify-spec-U1-core.sh` must exit 0.
- Commit: single commit `[U1-core] add channel-agnostic transcribeAudioBuffer helper + whisper_transcribe.py`.
- This sub-component does NOT push to any remote. U1-wa and U1-tg handle channel-fork remotes separately.
