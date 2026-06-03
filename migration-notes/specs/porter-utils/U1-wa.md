# U1-wa — Voice transcription (WhatsApp fork)

Sub-component of U1 (see `U1.md`). Scope: WhatsApp adapter voice-message inbound handling. Lands in `noamrazbuilds/nanoclaw-whatsapp` (`whatsapp-fork`), not in `nanoclaw-v2`.

- **mechanism:** intent-port

## Source (v1)
- WhatsApp call site: `docs/v1-fork-reference/src/channels/whatsapp.ts:39` (import), `:376-383` (transcription call in handler).
- v1's `isVoiceMessage` predicate: `docs/v1-fork-reference/src/transcription.ts:130-132` (checks `msg.message?.audioMessage?.ptt === true`).
- v1's `transcribeAudioMessage(msg, sock)` (WhatsApp-bound helper): `docs/v1-fork-reference/src/transcription.ts:99-128` — wraps the buffer download + call to `transcribeAudioBuffer`. The v2 port inlines this into the adapter rather than maintaining a separate helper.
- Upstream reference commit (NOT to cherry-pick — wrong-tool per phase-2-spawn-issues.md): `c054cbc` on `whatsapp/skill/voice-transcription`. Used as a structural reference only.

## Behavioral spec (one paragraph)

When the WhatsApp adapter's `messages.upsert` handler observes a message with `audioMessage.ptt === true` (a voice note) and no associated text content, it downloads the audio buffer via `downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage })`, calls `transcribeAudioBuffer(buffer)` from v2 core's `src/transcription.ts`, and replaces the otherwise-empty content with the transcript string (or `FALLBACK_MESSAGE` when both local whisper and OpenAI fallback fail). The transcript flows through the normal text-message path — the agent receives voice notes as text. Reason: voice notes are first-class user input, especially in family/EMS/personal chats; without transcription they're dropped by the empty-content skip at the top of the handler.

## v2 hook point(s)

Working tree: `/home/nanoclaw/nanoclaw-v2-porter-U1-wa` (worktree of nanoclaw-v2's `.git`, branched off `whatsapp-fork/main`). Branch: `porter-U1-wa`.

- **`src/channels/whatsapp.ts`** (modified, ~30 LOC added):
  - Add `downloadMediaMessage` to the `@whiskeysockets/baileys` named imports.
  - Add `transcribeAudioBuffer`, `FALLBACK_MESSAGE` imports from `'../transcription.js'`.
  - Add private `isVoiceMessage(normalized: ProtoTypes.IMessage): boolean` helper checking `normalized.audioMessage?.ptt === true`.
  - In the `messages.upsert` handler, after the existing trigger-mention normalization and before the `if (!content) continue;` skip: when `!content && isVoiceMessage(normalized)`, download the buffer and call `transcribeAudioBuffer`; set `content = transcript ?? FALLBACK_MESSAGE`.

- **`src/transcription.ts`** (new, copy from `nanoclaw-v2/src/transcription.ts` at commit `9af8666`):
  - Provides `transcribeAudioBuffer` + `FALLBACK_MESSAGE` exports to the WhatsApp adapter.
  - Required for `whatsapp-fork`'s standalone build to succeed; without it the import would dangle in the fork's typecheck.

- **`scripts/whisper_transcribe.py`** (new, copy from `nanoclaw-v2/scripts/whisper_transcribe.py`):
  - Backend script the transcription helper subprocess-invokes. Same sha256 across all worktrees (`e583462dcd0fe18e5ee141f4f159e7f567b911d2860341fa3959ac5c27ef1710`).

- **`package.json`**: add `openai` dep at `^6.27.0` (matches v1 production version).

## v2-native equivalent that might suffice?

**DOES-NOT-EXIST** in whatsapp-fork/main. Verifiable via `git grep -E 'transcribeAudio|isVoiceMessage' whatsapp-fork/main -- src/channels/whatsapp.ts` (empty as of 2026-06-03). Upstream's `whatsapp/skill/voice-transcription` (`c054cbc`) provides the same shape, but its cherry-pick produces 4 conflicts against `whatsapp-fork/main` (verified 2026-06-02). Intent-porting from v1's pattern is cleaner.

## Verification artifact

- Patch: `migration-notes/patches/U1-wa.patch` — `git diff whatsapp-fork/main..HEAD` from the porter worktree at commit time, saved into nanoclaw-v2's tree.
- Verify script: `scripts/verify-spec-U1-wa.sh` — runs against the porter worktree at `/home/nanoclaw/nanoclaw-v2-porter-U1-wa`. Checks: `src/transcription.ts` present (and sha matches v2-migration's), `scripts/whisper_transcribe.py` present (sha matches), `src/channels/whatsapp.ts` contains the voice handler block, `package.json` has openai dep, `pnpm install --frozen-lockfile` succeeds, `pnpm run build` succeeds. Optional `pnpm test` — runs only if existing tests exist on the fork.
- Captured expected output: `migration-notes/verification-outputs/U1-wa.txt`.

## Decisions / open questions

1. **Mirror v2 core `transcription.ts` into whatsapp-fork.** Reason: whatsapp-fork is a full NanoClaw fork that needs to build standalone (its CI / dev workflow / `pnpm run build` all expect import paths to resolve). The alternative — dynamic import with `any` cast — works at runtime but loses typecheck coverage. Mirror keeps the fork self-contained. Maintenance cost: when upstream syncs eventually merge a transcription helper into channels branch, a one-line conflict resolution.
2. **Baileys version: leave as-is on whatsapp-fork's `^6.17.16`.** `downloadMediaMessage` is API-stable across 6.x and 7.x. v2's `/add-whatsapp` SKILL.md pins baileys to `7.0.0-rc.9` in the install, but the fork's own package.json doesn't have to match — only the source file matters for installs.
3. **isVoiceMessage placement: private to whatsapp.ts.** Not exported. v1 had it as a module-level export of transcription.ts; v2's separation (channel-agnostic core vs channel-specific adapter) puts the predicate next to the adapter that uses it.
4. **Open: `proto as ProtoTypes` import already in whatsapp.ts** — use `ProtoTypes.IMessage` as the type for `normalized` in the predicate. Confirmed by reading the existing import shape at whatsapp.ts:14-19.

## Notes for Porter

- Pre-flight: `bash scripts/lock-spec.sh U1-wa` must exit 0 before any apply action. The check runs against the spec in nanoclaw-v2, but the changes land in the porter worktree.
- Working tree: `/home/nanoclaw/nanoclaw-v2-porter-U1-wa` (already created via `scripts/setup-porter-worktree.sh U1-wa --base whatsapp-fork/main`).
- Apply: write the three files (transcription.ts copy, whisper_transcribe.py copy, whatsapp.ts edit), add openai dep, `pnpm install`, then commit on `porter-U1-wa`.
- Verify: `bash scripts/verify-spec-U1-wa.sh` must exit 0. (Runs the verification against the porter worktree.)
- Pushes: NONE. The work stays on local branch `porter-U1-wa` until explicit cutover approval.
- Generate patch: `cd /home/nanoclaw/nanoclaw-v2-porter-U1-wa && git diff whatsapp-fork/main..HEAD > /home/nanoclaw/nanoclaw-v2/migration-notes/patches/U1-wa.patch`.
- The patch artifact lives in nanoclaw-v2's tree (auditable from v2-migration); the actual commit lives on `porter-U1-wa` in the shared .git.
