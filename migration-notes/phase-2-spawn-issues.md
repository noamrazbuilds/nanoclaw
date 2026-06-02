# Phase 2 spawn-time issues (2026-06-02)

Captured at the point of rollback. This doc exists so the issues survive the rollback of the unlock-5 spec changes and become input to the gauntlet that will redesign Phase 2.

## Timeline

- **2026-05-19:** Phase 1 (spec extraction) declared COMPLETE — 22 specs locked, queue re-locked, "ready for Porter agents."
- **2026-06-02:** First Phase 2 Porter spawn attempt. Aborted at Phase 1 step 2 of the U1 Porter. Multiple structural issues surfaced. User direction: rollback all of Phase 2, gauntlet the issues, replan, implement.

## Issue 1 — Skill-branch mechanism mismatch

**Spec said:** "Apply `whatsapp/skill/voice-transcription`" (and similar across U2, F6, CH1, CH3, U5b). Implied a `git merge` of the skill branch into the fork main.

**Reality:** WhatsApp skill branches are 17–25 commits ahead of `whatsapp-fork/main`, but only 1–2 of those are actual feature commits; the rest is "merge main into skill" noise. A `git merge` of the skill branch into the fork pulls in ~8K LOC of unrelated drift. The right tool was a `git cherry-pick` of just the feature commit(s).

**How it was caught:** Pre-spawn audit (mine, at Phase 2 setup) examined divergence shapes via `git rev-list` and identified that "merge" was wrong-tool. I revised six specs to switch the framing to `git cherry-pick <commit>`.

**Why the spec extraction missed it:** The spec authors (gauntlet plan + Verifier passes + spec extraction itself) treated the skill-branch name as the unit of work without checking what mechanism would actually apply that branch's content. The "Confirm at spec extraction" clause was supposed to catch this — but its check was about *whether upstream main had merged the skill* (a different question), not about whether the prescribed mechanism would actually work.

## Issue 2 — Conflict surface fabrication (the meta-failure)

**What I claimed in the unlock-5 spec revision:** "Expected single conflict on `package-lock.json`" for `c054cbc`, "single conflict on `container/agent-runner/src/index.ts`" for `dfc23a2`, etc. — verified via `git merge-tree`.

**Reality:**

| Cherry-pick | Real conflict count | Files |
|---|---|---|
| `c054cbc` → whatsapp-fork/main | 4 | package-lock.json, package.json, src/channels/whatsapp.ts, src/channels/whatsapp.test.ts |
| `dfc23a2` → whatsapp-fork/main | 5 | + container/agent-runner/src/index.ts, src/container-runner.ts |
| `a23e372` → whatsapp-fork/main | 7 incl. 2 add/add | db.ts, db.test.ts, index.ts, ipc.ts, whatsapp.ts, whatsapp.test.ts, ipc-mcp-stdio.ts |
| `e87d15d` → v2-migration | 3 incl. 1 modify/delete | src/formatting.test.ts, src/index.ts, src/router.ts |

**Root cause:** I ran `git merge-tree --write-tree X Y 2>&1 | head -3` and reported the truncated output as authoritative. The first lines of merge-tree output are just the first conflicting blob's stages; truncating after 3 lines reports only the first conflicting file regardless of how many exist.

**Why this matters:** This is the exact fabrication pattern that the C6 spec (and the concert task incident) is meant to prevent — confident citation of a metric derived from incomplete data. The Porter caught it because the spec said "STOP if conflicts exceed expected" and the Porter actually counted, but the spec wouldn't have said "1 conflict expected" if I'd looked at the full merge-tree output.

**Implication for replan:** Any future "verify X" claim in a spec needs to be reproducible — the verification command must be in the spec, and someone (or some automation) must re-run it without paraphrase or truncation. "I checked, looks fine" is not verification.

## Issue 3 — Telegram voice handler already exists (scope error)

**Spec said (pre-unlock-5):** U1 Telegram scope is to add a ~30 LOC `bot.on('message:voice')` registration to `telegram-fork/main:src/channels/telegram.ts`. "Upstream has no Telegram voice support — fork-only addition."

**Reality:** `telegram-fork/main:src/channels/telegram.ts:311` already has a bare `bot.on('message:voice', ...)` handler. It just stores `[Voice message]` + fileId; no download, no transcription. U1's actual scope was to **replace the handler body**, not to add a new registration.

**Why the spec extraction missed it:** Same pattern as Issue 1 — assumption about what the fork looked like, without reading the fork's actual `telegram.ts`. The Verifier passes audited upstream and the WhatsApp fork but didn't run `git show telegram-fork/main:src/channels/telegram.ts | grep voice`.

## Issue 4 — `isolation: worktree` isolates the wrong repo

**What I expected:** Spawning a general-purpose Agent with `isolation: worktree` creates an isolated worktree of `~/nanoclaw-v2` (where the migration work lives, where my CWD is during the session).

**What actually happened:** The harness created a worktree of `/home/nanoclaw/NanoClaw` (the production repo), because the Claude Code session is anchored to that repo's `.git`, not nanoclaw-v2's. So the Agent landed in `/home/nanoclaw/NanoClaw/.claude/worktrees/agent-XXX` with no `migration-notes/`, no v2 source. The Agent improvised by creating its own worktree at `/home/nanoclaw/nanoclaw-v2-u1-work`.

**Implication:** The isolation feature doesn't help with v2-migration work in this session. Future Porter spawns either need to (a) operate in a pre-created v2-migration worktree without isolation, (b) accept the topology mess of operating across two .git directories, or (c) the session itself needs to be re-anchored at nanoclaw-v2 (which would break /home/nanoclaw/NanoClaw context).

## Issue 5 — Install-wiring is undocumented but blocks the migration

**What the spec says:** U1/U2/F6/CH1 land code in the WhatsApp/Telegram **fork repos** (`noamrazbuilds/nanoclaw-whatsapp`, `noamrazbuilds/nanoclaw-telegram`).

**What actually wires the install:** `/.claude/skills/add-whatsapp/SKILL.md` (in nanoclaw-v2) line 29 does `git fetch origin channels && git show origin/channels:src/channels/whatsapp.ts > src/channels/whatsapp.ts`. The install pulls from a `channels` branch in the **main NanoClaw repo**. Also: `origin/channels` (= `noamrazbuilds/nanoclaw`'s channels branch) **does not exist** — only `upstream/channels` (the qwibitai org's channels branch) does.

**Implication:** Code landing in the WhatsApp fork doesn't reach any v2 install until either (a) the fork content is synced into `noamrazbuilds/nanoclaw`'s `channels` branch (which doesn't exist), or (b) the SKILL.md is updated to fetch from the fork directly. The unlock-5 spec revisions documented this as "Phase 4/5 work, not in U1 scope" — but Phase 4 is cutover and Phase 5 is upstream-contribution prep. Where does the install-wiring actually live in the plan?

## Issue 6 — Verifier passes (Scout, V1, V2) didn't catch any of 1–5

**Background:** Phase 1 prep included three Verifier passes plus a 2-pass upstream-skill parity audit, totaling 5 separate verification efforts before spec extraction. Each found real issues (C6 added, U1/F6/U3 scope-reduced, F5 reduced to 2 tools). Each ALSO produced false confidence — the audit work felt thorough.

**What the Verifiers actually checked:** Existence of files and code symbols (`git ls-tree`, `git grep`), commit-message inspection (`git log --oneline`), and line-citation diffs ("line 235 in skill vs line 408 in v1 — same shape"). What they DIDN'T check: the actual `git merge` / `git cherry-pick` would succeed; the resulting code would compile; the prescribed mechanism would produce the expected diff.

**Pattern:** Verification examined the *artifacts* (files, commits) but not the *operations* (merge, cherry-pick, build, test). Issues 1, 2, 3 all stem from operations not being exercised end-to-end before spec lock.

## Issue 7 — I (Claude) fabricated, then the Porter I spawned caught me

Worth saying directly because the user (Noam) has spent the last month getting paranoid about fabrication after the concert task incident. The Porter brief said "STOP if conflicts exceed expected." The Porter aborted at 4 conflicts when spec said 1. Without that explicit STOP rule (which I wrote based on Issue 6 lessons from the gauntlet plan), the Porter could have plowed forward and produced 4 silently-wrong conflict resolutions. The discipline worked for the Porter but not for me — the unlock-5 spec revision was made *after* the user explicitly chose "pause and revise to prevent C6 failure mode."

## What's preserved as durable input to the gauntlet

- This doc (`migration-notes/phase-2-spawn-issues.md`)
- The full conversation transcript with the user (in Claude Code session history)
- The Porter's final report (verbatim in the conversation; reproduced below for offline reference)

## Porter final report (verbatim)

> # U1 Porter Report — STOPPED at Phase 1, step 2
>
> ## 1. Confirm-step result
> **Pass.** `upstream/main` has no `transcribeAudio*` symbols and no transcription-related commits to `src/channels/whatsapp.ts` since 2026-05-19. Cherry-pick path is not superseded.
>
> ## 2. Commits per worktree
> **None.** Halted before any commit was made.
>
> ## 5. Conflicts encountered
> - **WhatsApp fork `git cherry-pick c054cbc`:** 4 conflicts, not 1. Spec predicted only `package-lock.json`; actual conflicts in `package-lock.json`, `package.json`, `src/channels/whatsapp.test.ts`, `src/channels/whatsapp.ts`. Confirmed independently with `git merge-tree HEAD c054cbc`. **Aborted per hard rule; reporting.**
>
> ## 6. Open questions
> - **CWD mismatch with brief.** Brief paragraph 2 says my CWD is "an isolated copy of nanoclaw-v2 on a temp branch." Actual CWD `/home/nanoclaw/NanoClaw/.claude/worktrees/agent-ac707f78e57aedbf7` is a worktree of the **production** `/home/nanoclaw/NanoClaw` repo (different remotes, different content — no `migration-notes/`, no v2 source). I created a proper isolated v2 worktree at `/home/nanoclaw/nanoclaw-v2-u1-work` on branch `u1-voice-transcription` (off `v2-migration`) for Phase 3 work; it's clean and ready, but I did not write any files into it. Please confirm this is the intended Phase 3 location before I continue.
> - **U1 spec conflict prediction is wrong.** Spec lines 28-29 say `c054cbc` produces a single `package-lock.json` conflict, "verified via `git merge-tree`." That verification claim does not match what `git merge-tree HEAD c054cbc` shows in `whatsapp-fork/main` today (4 conflicts). Either (a) the spec verification was done against a different base, (b) `whatsapp-fork/main` has moved since unlock-5, or (c) the verification was mis-recorded.

## Questions the gauntlet should answer

1. **Is Path D (parallel-track cutover) still the right strategy** given the spec-extraction work has surfaced as less reliable than assumed? Or does the failure mode suggest a different vehicle — e.g. fresh-fork-greenfield, where the migration target is a clean checkout and customizations get re-implemented from behavioral specs without trying to reuse skill-branch commits?
2. **For each preserved customization that requires touching channel-fork repos**, what mechanism actually applies — `git cherry-pick` (slow with conflicts), hand-port (slower but transparent), or replay-from-behavioral-spec (slowest, most resilient)?
3. **What verification discipline prevents Issue 2 (truncated-output fabrication)** from happening at Phase 2.1 the same way it happened at Phase 2.0? Specifically: which verification claims need to be in machine-checked / reproducible form before a spec can be considered "locked"?
4. **Where does install-wiring live in the plan** (Issue 5)? The fork repos won't reach v2 installs without explicit sync or SKILL.md edits. Should this be Phase 1c, a new phase, or part of cutover?
5. **What's the right granularity for Porter execution** given that conflict resolution requires judgment calls that don't compress well into a spec? Options: (a) keep specs at current ~30-line size and accept that Porters will frequently STOP and need human conflict-resolution input; (b) make specs much larger with per-conflict resolution guidance (10x effort to write but Porters are autonomous); (c) abandon the Porter pattern and accept that this migration is a human-driven exercise with Claude assisting interactively.
6. **What checks-and-balances** prevent the next Verifier pass from producing false confidence like the existing three did?
