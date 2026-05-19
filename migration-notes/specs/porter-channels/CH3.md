# CH3 — whatsapp-auth.ts clash resolution

## Source (v1)
- v1: `docs/v1-fork-reference/src/whatsapp-auth.ts` (181 LOC). Standalone script that renders QR via `qrcode-terminal` directly to stdout; uses readline for interactive prompts. Status files `store/qr-data.txt` + `store/auth-status.txt`. **Does NOT have the Baileys getPlatformId v6 bug fix.**
- Upstream: `setup/whatsapp-auth.ts` (221 LOC, on `whatsapp/main`). Emits structured status blocks (`WHATSAPP_AUTH_QR`, `WHATSAPP_AUTH_PAIRING_CODE`, `WHATSAPP_AUTH`) for parent setup:auto driver to render in clack UI. Has Baileys getPlatformId v6 bug fix (lines 50-70). Browser method dropped (header: "one less moving part and it kept biting headless/SSH users"). Integrates with `setup/status.ts` emitStatus helper.

## Behavioral spec (one paragraph)
The WhatsApp authentication script is a one-shot setup step that links the NanoClaw instance to a WhatsApp account via Baileys. Two authentication methods: **QR code** (default — show rotating QR to user, accept scan) and **pairing code** (request 8-character code with phone number, user enters it on phone). On success, Baileys credentials land in `store/auth/` (multi-file auth state); process exits 0. On failure (timeout, network, user cancellation), exits non-zero with structured error. In v2 architecture, the script is invoked by `setup:auto` as a step; the parent driver renders the QR/pairing-code UX in its clack-based terminal UI (the script emits status-block events, parent reads + renders). This is **strictly better** than v1's approach (script renders QR to stdout directly) because: (a) integrates with the setup wizard's overall UX, (b) works in headless/SSH scenarios where stdout QR rendering breaks, (c) handles Baileys v6's `getPlatformId` bug (which sends charCode `49` instead of enum value `1`, causing pairing codes to fail with "couldn't link device" — fixed in Baileys 7.x but not backported, so the script patches the underlying generics module at startup). The reason CH3 exists as a row: the file lives in two different locations across v1 and upstream (v1: `src/whatsapp-auth.ts`; upstream: `setup/whatsapp-auth.ts`), making a naive merge produce a phantom split-brain.

## v2 hook point(s)
**Resolution: TAKE upstream verbatim. DROP v1's version.** Specifically:
- **Keep**: `setup/whatsapp-auth.ts` from upstream's `whatsapp/main`. Already in v2 worktree from the base merge.
- **Drop**: v1 fork's `src/whatsapp-auth.ts` (181 LOC). Frozen in `docs/v1-fork-reference/` as reference only; no code path imports it in v2.
- **Verify on CH1 merge completion**: the Baileys `getPlatformId` fix at `setup/whatsapp-auth.ts:50-70` is still present (this fix is fork-original via upstream — confirm it survived any merge from the WhatsApp skill branches).
- **No new code**. The decision IS the spec.

## v2-native equivalent that might suffice?
**EXISTS-NATIVELY (and is strictly better).** Upstream's version supersedes v1's on every axis: architectural integration with setup:auto, Baileys v6 fix, headless-friendly status blocks. v1's version was a pre-v2 standalone with no parent driver to integrate with — obsolete in v2's setup model.

## Decisions / open questions
1. **Browser-method preservation**: v1's version had a `browser: Browsers.macOS('Chrome')` config (line 79). Upstream also has this (line 154) but explicitly dropped the **browser-based auth method** (one of the auth choices, not the Browsers config string). Confirmed: the user-facing "browser method" choice was the headless-failing path; the Baileys `Browsers.macOS('Chrome')` string identifier remains in both. No action needed.
2. **`setup/status.ts` dependency**: upstream's version imports `emitStatus` from `./status.js`. Verify that helper is present in v2 worktree (should be — comes with the upstream base merge).
3. **Future: contribute the Baileys fix upstream?** The `getPlatformId` patch is a Baileys-side bug workaround. Per [[project_upstream_contribution_prep]], this might be valuable to upstream — but per the upstream skill's header comment, it ALREADY originated from the channels-branch version, so it's already upstream. No contribution work needed for CH3.

## Notes for Porter
- **One-line task**: confirm v1's `src/whatsapp-auth.ts` is NOT referenced anywhere in v2's import graph (`grep -r "from.*whatsapp-auth\|from.*src/whatsapp-auth" src/ setup/`). If clean, no action. If anything imports the v1 path, replace with `setup/whatsapp-auth.ts` import.
- **Smoke-test post-merge**: run `npm run setup:auth-whatsapp` (or whatever the setup:auto step name is) and verify the QR renders inside clack UI, not as raw stdout.
- **Sequencing**: CH3 should run AFTER CH1 (so the WhatsApp skill merges are settled before validating the auth path). CH3 has zero dependencies on CH2 (Telegram).
- **No tests needed beyond smoke**: this is a one-shot setup script; behavior validation is "did it auth successfully?"
- **Production migration**: existing `store/auth/` from v1 instance will Just Work post-merge — Baileys credentials are version-stable across the v1→v2 jump.
