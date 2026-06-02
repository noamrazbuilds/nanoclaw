# U5b — text-styles.ts (channel-native markdown formatting)

## Source (v1)
- File: `docs/v1-fork-reference/src/text-styles.ts` (337 LOC).
- Exports: `parseTextStyles(text, channel)`, `parseSignalStyles(rawText)`, types `ChannelType` + `SignalTextStyle`.
- Channels covered: WhatsApp, Telegram, Slack, Discord, Signal (each with its own transformation rules).
- **Byte-identical to upstream's `skill/channel-formatting` version** — verified 2026-05-19 via `diff` against `upstream/skill/channel-formatting:src/text-styles.ts`.
- Origin: pre-fork upstream feature; the fork carried it forward unmodified.

## Behavioral spec (one paragraph)
Before delivering an agent response to a channel, convert Claude's Markdown output to that channel's native text syntax: WhatsApp uses `*bold*`/`_italic_` (not `**`/`*`), Telegram uses the same with links preserved, Slack uses `<url|text>` link syntax, Discord renders Markdown natively (passthrough), Signal gets a special `parseSignalStyles` path that returns plain text + native `textStyle` ranges (consumed by the Signal channel skill to use Signal's protobuf rich-text). Code blocks (fenced and inline backticks) are always protected — their content is never transformed, even if it contains formatting-looking syntax. The reason: without this, agent responses render with literal `**asterisks**` in WhatsApp/Telegram (which don't support that markdown variant) — visually broken. With it, formatting renders naturally on every channel.

## v2 hook point(s)
**Resolution: REPLACE v1's port with upstream skill — cherry-pick `e87d15d`** (the feature commit on `upstream/skill/channel-formatting`). Specifically:
- **Cherry-pick mechanics on v2-migration**: `git cherry-pick e87d15d` from `upstream/skill/channel-formatting`. Skill branch is only 3 commits ahead of `upstream/main` — small enough that a branch merge would also be viable, but cherry-pick keeps the framing consistent with U1/U2/F6/CH1 and avoids dragging in the merge commits anyway. Expected single conflict on `src/formatting.test.ts` (verified via `git merge-tree`); resolve by reading both sides — cherry-pick side is canonical for the new transform tests.
- Brings in `src/text-styles.ts` (byte-identical to v1), updated `src/formatting.test.ts`, `container/skills/slack-formatting/SKILL.md`, plus the `.claude/skills/channel-formatting/SKILL.md` manifest.
- Optionally also cherry-pick `ccb4523` (dep cleanup — removes direct pino/pino-pretty) if it doesn't conflict with v2-migration's logging setup. Verify with `git merge-tree --write-tree v2-migration ccb4523` before applying.
- **No fork delta**. Drop v1's stashed copy (it's frozen reference only; never imported in v2).
- **Outbound wiring**: the skill ships with hookup into v2's outbound pipeline (per the SKILL.md description "wires channel-aware Markdown conversion into the outbound pipeline so Claude's responses render natively on each platform"). Verify post-cherry-pick.

## v2-native equivalent that might suffice?
**EXISTS-NATIVELY (on skill branch).** `upstream/skill/channel-formatting` carries byte-identical text-styles.ts plus the wire-up into v2's outbound pipeline. Zero fork delta needed. Same pattern as U3 (status-tracker, bundled in F6 skill) and F6 (reactions, full coverage on skill branch).

## Decisions / open questions
1. **Feature-commit pinning**: same approach as CH1 — cherry-pick the specific feature commit (`e87d15d`) identified by the 2026-06-02 audit, not the skill branch HEAD blindly. Re-verify the commit still exists before running. The audit found only 3 commits ahead total, so HEAD might also work, but cherry-pick keeps the framing consistent with the rest of Phase 1.
2. **Outbound integration site verification**: SKILL.md says the skill "wires channel-aware Markdown conversion into the outbound pipeline." Confirm the wire-up site at merge time — likely `src/delivery.ts` or `src/router.ts`. If v2 main has drifted from the skill's expected base, the wire-up may need adjustment.
3. **`channel-formatting` interaction with v2's outbound vocabulary** (`chat | edit | reaction | ask_question | card`): the text-styles transform applies to text-bearing kinds (`chat`, `edit`, `ask_question`'s prompts, `card`'s title/body). Reactions are emojis — no transform needed. Verify the integration only fires on text-bearing kinds.
4. **Container `slack-formatting` skill**: the merge brings in `container/skills/slack-formatting/SKILL.md`. If Slack isn't in scope for this fork's use, the SKILL.md is dead weight but harmless. Leave it (low cost; future-Slack-channel-ready).

## Notes for Porter
- **Two-line task**: cherry-pick `e87d15d` + drop v1's stashed text-styles.ts from any import paths (`grep -r "from.*text-styles" src/ setup/` — should return zero hits after the cherry-pick since the skill provides the same file).
- **Test**: send a message with `**bold text**` from the agent → verify WhatsApp shows `*bold text*` (single asterisks), Telegram same, Slack same, Discord shows `**bold text**` (passthrough).
- **Sequencing**: U5b is independent of all other Phase 1c rows. Can ship anytime after Phase 1b is complete.
- **Same shape as CH3**: "take upstream verbatim, drop v1's stashed reference." No new code.
- **Future upstream-contribution candidate**: if the fork ever adds new channel transformations (e.g., the dedicated Gmail channel from [[plan_definitely_yes_integrations]]), extend this skill upstream.
