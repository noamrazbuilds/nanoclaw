# Phase 0 findings (2026-06-02 / 2026-06-03)

Issues surfaced during Phase 0 execution (foundations + install-wiring fix) that weren't anticipated in `phase-2-revised-plan.md`. Each finding has a recommended action and a phase-tag for when it gets resolved.

## Finding F0-1 — Telegram fork is structurally incomplete vs upstream/channels

**Found at:** Phase 0 deliverable #4 (install-wiring fix).

**The check:** verified all files referenced by `.claude/skills/add-telegram/SKILL.md` exist in `telegram-fork/main` (`noamrazbuilds/nanoclaw-telegram`) via `git cat-file -e <ref>:<path>`.

**Result:**

| File | telegram-fork/main | upstream/channels |
|---|---|---|
| `src/channels/telegram.ts` | ✅ present | ✅ present |
| `src/channels/telegram-pairing.ts` | ❌ missing | ✅ present |
| `src/channels/telegram-pairing.test.ts` | ❌ missing | ✅ present |
| `src/channels/telegram-markdown-sanitize.ts` | ❌ missing | ✅ present |
| `src/channels/telegram-markdown-sanitize.test.ts` | ❌ missing | ✅ present |
| `setup/pair-telegram.ts` | ❌ missing | ✅ present |

**Implication:** The Phase 0 install-wiring fix (modify `add-telegram/SKILL.md` to fetch from `telegram-fork/main` instead of `origin/channels`) **cannot be applied for Telegram** without first syncing these 5 files into the fork. If the SKILL.md were flipped today, `/add-telegram` would fail at 5 of 6 `git show` invocations and the install would silently produce a broken Telegram channel.

**Why this matters for the migration:** when Phase 2 lands Telegram-side U1 work (voice handler body replacement in `src/channels/telegram.ts`), the change is consumable by a v2 install only if the install actually fetches from `telegram-fork`. Currently the install fetches from `origin/channels` (which doesn't exist in `noamrazbuilds/nanoclaw`; only `upstream/channels` does). So either:

- Telegram channel installs **fail outright** (no `origin/channels` to fetch from in the user's fork repo), OR
- The user has previously fetched `upstream/channels` and aliased it, OR
- Telegram install hasn't been validated end-to-end in the user's v2 setup yet

The WhatsApp side **does work** because `whatsapp-fork/main` has all three files (`src/channels/whatsapp.ts`, `setup/whatsapp-auth.ts`, `setup/groups.ts`) — the Phase 0 install-wiring change for WhatsApp landed cleanly (commit `<TBD>` for `add-whatsapp/SKILL.md`).

**Options for resolution:**

1. **Sync the 5 files from upstream into `telegram-fork/main`.** A one-time push on GitHub: cherry-pick the relevant upstream commits or copy the files. Restores symmetry with `whatsapp-fork/main`. After sync, re-apply the install-wiring change to `add-telegram/SKILL.md`. **Recommended.** ~15 min of user action, no code changes.

2. **Hybrid install: fetch telegram.ts from fork, helpers + setup from upstream.** Requires the install to add both `telegram-fork` AND `upstream` remotes. More complex SKILL.md; brittle if upstream relocates files. Not recommended.

3. **Leave `add-telegram/SKILL.md` fetching from `origin/channels`.** Accept that Telegram install-wiring is the long pole; Phase 2 Telegram work won't reach installs until either (1) or a different cutover mechanism is built. Acceptable as a short-term state.

**Phase tag:** Phase 0 prerequisite for `add-telegram` install-wiring; should be resolved before Phase 2 batch 2 (Telegram porting) so that Phase 2 work is install-reachable at cutover. Tracked in TaskList as a sub-task of the Phase 2+ implementation.

**Status:** ✅ RESOLVED 2026-06-03. Option 1 executed: 5 missing files synced from `upstream/channels` (at `43adb19`) into `noamrazbuilds/nanoclaw-telegram/main` via fast-forward push (commit `5dbe118` on telegram-fork main). After sync, all 6 files referenced by `add-telegram/SKILL.md` verified present in `telegram-fork/main`. The SKILL.md was then flipped to fetch from `telegram-fork/main` instead of `origin/channels`. Phase 0 install-wiring (deliverable #4) is now complete for both WhatsApp and Telegram.

## Finding F0-2 — `.git` is a worktree pointer file, not a directory (script bug)

**Found at:** Phase 0 deliverable #1 (`scripts/verify-operation.sh`) initial test.

**Issue:** The script's check for an in-progress cherry-pick used `[ -f .git/CHERRY_PICK_HEAD ]`, which fails when `.git` is a worktree pointer file (as it is when v2-migration is a git worktree of NanoClaw's main `.git`). The check returned false negative and the script's cleanup logic was skipped, leaving unmerged paths after `--abort`.

**Fix:** Resolve the actual git directory with `git rev-parse --git-dir` and use that path for state files. Also added a `git reset --hard HEAD` after abort since `--abort` alone doesn't always clean unmerged index entries on heavy conflict sets.

**Resolution:** Committed in `205a786` (verify-operation.sh fix).

**Phase tag:** resolved within Phase 0.

## Finding F0-3 — Backticks in double-quoted bash strings = unintended command substitution

**Found at:** Phase 0 deliverable #2 (`scripts/lock-spec.sh`) initial test.

**Issue:** My `fail "..."` message strings contained `` `git show` `` / `` `git log` `` / etc. The backticks inside double quotes triggered bash command substitution; `git ls-tree` ran with no args and spilled its usage info into the error output.

**Fix:** Replaced backticked references with plain text in message strings.

**Resolution:** Committed in `75f541d` (lock-spec.sh).

**Phase tag:** resolved within Phase 0. Worth noting for future scripts.

## Finding F0-4 — Plan over-promised "template self-verifies"

**Found at:** Phase 0 deliverable #3 (`migration-notes/specs/_TEMPLATE.md`).

**Issue:** `phase-2-revised-plan.md` Phase 0 exit criteria stated "`bash scripts/lock-spec.sh _TEMPLATE` succeeds (template self-verifies)." But a template can't have a real patch + verify script without being a circular self-reference. The substantive requirement is that `lock-spec.sh` runs cleanly against real (filled-in) specs.

**Resolution:** Template includes an implementation note flagging the over-promise. Treat the plan's line as "the script exists and runs cleanly against real specs."

**Phase tag:** documentation correction, no code change needed.

---

## Net Phase 0 progress

- ✅ Deliverable #1: `scripts/verify-operation.sh` (with F0-2 fix)
- ✅ Deliverable #2: `scripts/lock-spec.sh` (with F0-3 fix)
- ✅ Deliverable #3: `migration-notes/specs/_TEMPLATE.md` (with F0-4 noted)
- ✅ Deliverable #4: install-wiring fix
  - ✅ WhatsApp side: `add-whatsapp/SKILL.md` flipped to `whatsapp-fork/main`
  - ✅ Telegram side: `add-telegram/SKILL.md` flipped to `telegram-fork/main` after F0-1 resolution
- ✅ Deliverable #5: `scripts/setup-porter-worktree.sh`

**Phase 0 is COMPLETE** as of 2026-06-03.
