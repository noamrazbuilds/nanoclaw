# Phase 2+ Revised Plan (locked 2026-06-02)

This plan supersedes the Porter-execution strategy in `phase-1-prep.md`'s "What happens after Phase 1 prep" section. It was synthesized after Phase 2 attempt #1 (2026-06-02) aborted at the first Porter and surfaced seven structural issues — see `phase-2-spawn-issues.md` for the full failure record.

## Evidence base

Two structured gauntlets (Claude Opus 4.6 + GPT-4o + Gemini 2.5 Pro design; in practice each run had one voice fail to a quota/rate limit, giving 2 separate 2-voice debates):

- **Run 1** (`gauntlet-logs/gauntlet-2026-06-02-160120.md`): Opus + Gemini. GPT-4o billing-blocked. Produced concrete verification commands (`git cherry-pick --no-commit` + untruncated capture), Phase 0 foundations structure, and **caught a data-migration omission both voices initially missed**.
- **Run 2** (`gauntlet-logs/gauntlet-2026-06-02-190420.md`): Opus + GPT-4o. Gemini rate-limited. Confirmed strategy + mechanism + verification-direction; vaguer on specifics; did not surface data migration.

All three voices weighed in across both runs on the load-bearing decisions; Run 1's concrete recommendations are adopted; Run 2 serves as cross-validation.

## Strategy (Q1) — Path D refined

Keep **Path D — Parallel-Track Cutover**. The Phase 2 attempt #1 failure was tactical (wrong mechanism, missing verification discipline), not strategic. Production NanoClaw at `/home/nanoclaw/NanoClaw` remained untouched throughout the failure and rollback. The atomic-cutover + <60s rollback property is intact.

What changes inside Path D: the spec-extraction-then-Porter-execution pipeline gets replaced by Phase-0-foundations-then-batched-porting with hard verification gates.

## Mechanism (Q2) — Hybrid, default = human-guided intent porting

Three modes, chosen per row, declared in the spec:

1. **Default: Human-Guided Intent Porting (via committed `.patch`).**
   1. Identify the minimal set of v1 feature commits for the row.
   2. Generate a clean diff against the v2 base:
      ```
      git diff $(git merge-base v2-migration <v1-feature-commit>)...<v1-feature-commit> > migration-notes/patches/<row-id>.patch
      ```
   3. Read the diff. Manually implement the same intent against v2 idioms in a Bash/Edit session, with a human (Noam) approving each chunk.
   4. The resulting working-tree diff is committed (the patch file is *also* committed) and becomes the audit artifact.
   5. Porter (if used at all for this row) deterministically re-applies the patch as a verification re-run; it does NOT re-derive the changes.

2. **Contingent: Verified Cherry-Pick.** Only used when the verification gate (Q3) shows the cherry-pick applies with ≤1 expected, named conflict file. The spec must record the exact pre-captured `git cherry-pick --no-commit` output. If actual deviates, abort.

3. **Architectural mismatch: Re-implement from behavioral spec.** For rows where v2's paradigm differs from v1's (e.g. U5b text-styles where upstream has a parallel skill), discard v1 source and write fresh v2-idiomatic code from the behavioral spec only.

The choice between modes is **declared per row in the spec** (`mechanism: intent-port | cherry-pick | reimplement`) and locked at spec time.

## Verification discipline (Q3) — Operational dry-runs with untruncated capture

The truncation fabrication that caused Phase 2 attempt #1's spec drift (`git merge-tree | head -3` reported 1 conflict when reality was 4) must be impossible going forward.

Every verification claim in a spec is backed by a reproducible `scripts/verify-spec-<row-id>.sh` script in the repo. Each script:

1. Runs the operation in dry-run mode (`git cherry-pick --no-commit`, `git apply --check`, etc.) on a clean ephemeral worktree.
2. Captures stdout + stderr **without piping through head/tail/grep/awk** — full output goes to a file under `migration-notes/verification-outputs/<row-id>.txt`.
3. Runs `git status --porcelain` to produce a machine-readable list of modified/unmerged paths.
4. The script's exit code is 0 only if the captured output matches the spec's recorded expectation **byte-for-byte** (use `diff`, not regex).

The spec embeds the **exact expected output** as a fenced code block. Porter's job is to re-run the script and abort on any deviation.

**Concrete prohibition:** any verification command in a spec or in the planning phase MUST NOT contain `| head`, `| tail`, `2>&1 | head`, etc. unless the truncation is followed by `wc -l` or `wc -c` of the un-truncated source. Specs reviewed by `grep -nE "(merge-tree|cherry-pick|apply).*\|\s*(head|tail)" migration-notes/specs/` before lock; non-zero match count is a blocker.

## Install-wiring placement (Q4) — Phase 0

Today `/add-whatsapp`'s SKILL.md does `git fetch origin channels && git show origin/channels:src/channels/whatsapp.ts > src/channels/whatsapp.ts`. `origin/channels` doesn't exist in `noamrazbuilds/nanoclaw`; only `upstream/channels` does. Code landing in `noamrazbuilds/nanoclaw-whatsapp` won't reach v2 installs without a wiring fix.

**Resolution (Phase 0 task):** modify the v2 `.claude/skills/add-<channel>/SKILL.md` files to fetch from the channel-fork repos directly (e.g., `https://github.com/noamrazbuilds/nanoclaw-whatsapp.git` instead of `origin/channels`). This keeps channel code isolated in its own domain and means code landing in a channel-fork main branch is immediately consumable by v2 installs.

Trade-off: makes the install dependent on user's personal fork URLs rather than upstream's `channels` branch. Acceptable because the migration goal is precisely to keep user-specific customizations in the fork. Phase 5 (upstream contribution prep) is the optional path to PR fork changes back to qwibitai over time.

## Porter granularity (Q5) — Option (a): deterministic executor, STOP on deviation

Specs remain ~30 lines + a verification script. Porters are demoted to **applying a pre-vetted artifact** (patch file) and re-running the verification script. They have no judgment role. If the script fails byte-for-byte, the Porter STOPs and returns control to Noam.

The U1 Porter that STOPped on 4 conflicts in attempt #1 was the success case of this model, not the failure case. That behavior is preserved and reinforced.

## Checks-and-balances (Q6)

Four process changes embedded in this plan:

1. **Executable specs.** Each row spec ships with `scripts/verify-spec-<row-id>.sh` (verification gate) and `migration-notes/patches/<row-id>.patch` (intent artifact). Spec is not "locked" until both exist and the script exits 0 on first run.

2. **Red-team review by a second model.** Before a row's spec is locked, run a single-model critique (Claude Sonnet or Gemini Flash via LiteLLM, ~$0.01 / row, ~5 min) with the explicit objective: "find what this spec missed." Output filed under `migration-notes/red-team-reviews/<row-id>.md`. Spec author addresses each finding before lock.

3. **Mandatory integration checkpoints.** After each batch in Phase 2:
   - `pnpm install && pnpm run build && pnpm test` must pass.
   - Manual end-to-end verification against a documented test matrix (which features tested, what success looks like).
   - Checkpoint is a commit on `v2-migration` with subject `checkpoint: batch N (Y/Z rows green)`. If a row fails at checkpoint, it goes back to specification, not just to retry.

4. **Failure-mode regression tests.** For each of the 7 issues in `phase-2-spawn-issues.md`, an automated check is added to verification tooling that prevents recurrence:
   - Issue 1 (skill-branch mechanism mismatch): pre-spec-lock grep for `git merge.*skill/` in specs.
   - Issue 2 (truncated-output fabrication): pre-spec-lock grep for `| head` / `| tail` after `merge-tree` / `cherry-pick` / `apply`.
   - Issue 3 (TG handler exists): pre-spec-lock check that every "fork-only addition" claim has a corresponding `git show <ref>:<path> | grep <symbol>` that confirms the addition is actually new.
   - Issue 4 (isolation worktree): pre-Porter-spawn check that the Agent's CWD is a worktree of `nanoclaw-v2`, not of `NanoClaw`. If not, spawn a pre-created v2-migration worktree instead of relying on `isolation: worktree`.
   - Issue 5 (install-wiring): Phase 0 deliverable; no row in Phase 2 can be marked complete until install-wiring is verified.
   - Issue 6 (Verifier false confidence): the verification *operation* runs end-to-end, not just an artifact existence check.
   - Issue 7 (Claude fabricated): the assistant must paste full untruncated verification output into the conversation before claiming a spec is locked. Any "I verified X" claim without a verification-output paste in the conversation history is invalid.

---

# Revised phase structure

**Total estimated effort: 40-65 hours over 5-7 focused days.** Up from the original 30-45h. The increase reflects: explicit Phase 0 (8-12h), new data migration phase (4-6h), rigorous verification overhead per row (~30 min per row × 20 rows ≈ 10h), and re-specification of existing locked specs under the new discipline (~10-15h distributed across batches).

**Rollback path** at any pre-cutover stage: `git checkout main` in production worktree + `systemctl restart nanoclaw` → <60s recovery. Production `~/NanoClaw` is never modified before the explicit cutover step.

## Phase 0 — Foundations (8-12 hours)

Goal: establish trustworthy tooling and resolve foundational blockers before any feature work.

1. **`scripts/verify-operation.sh`** — generic verification harness. Takes operation type (cherry-pick, apply, merge-tree), target ref, optional expected-output file. Captures full output to disk, exits 0 only on byte-for-byte match.
2. **`scripts/lock-spec.sh <row-id>`** — pre-lock check runner. Greps the spec for the failure-mode patterns (Issue 1, 2, 3 above), runs the verify script, verifies patch file exists. Refuses to mark spec locked if any check fails.
3. **Install-wiring fix.** Modify `.claude/skills/add-whatsapp/SKILL.md`, `.claude/skills/add-telegram/SKILL.md`, and any other `add-*-fork-channel` skills to fetch from the user's channel-fork repos (URLs above). Validate by running each install skill against a fresh checkout and confirming the channel adapter lands.
4. **Re-spec template.** A canonical 30-line spec template at `migration-notes/specs/_TEMPLATE.md` that includes: row id, mechanism declaration, behavioral spec, verification-script reference, patch-file reference, red-team review reference. Used for re-specification across batches.
5. **Pre-create v2-migration porter worktree.** `git worktree add /home/nanoclaw/nanoclaw-v2-porter v2-migration` (or `/tmp/nanoclaw-v2-porter` if outside-home is preferred). Bypass `isolation: worktree` for future Porters; spawn them with no isolation and explicit working-directory targeting this pre-created worktree.

Phase 0 exit criteria: all 5 deliverables present in the repo; `bash scripts/lock-spec.sh _TEMPLATE` succeeds (template self-verifies); `/add-whatsapp` against a fresh v2 checkout produces a working WhatsApp adapter.

**Rollback:** Phase 0 changes are all under `scripts/` and `.claude/skills/`. To undo, `git checkout -- scripts/ .claude/skills/`.

## Phase 1 — Data migration (4-6 hours)

Goal: de-risk the most critical non-code component of the migration. v2's two-DB session split (`inbound.db` + `outbound.db`) + central DB schema changes (modular `src/db/` migrations) + v1 `scheduled_tasks` columns dropped silently by upstream's `setup/migrate-v2/tasks.ts` — all need explicit handling.

1. **Audit existing `setup/migrate-v2/*.ts`.** What does it cover; what does it drop silently. Cross-reference against fork-only v1 columns (`scheduled_tasks.model`, `scheduled_tasks.suppress_chat_output`, fork-only tables). Output: `migration-notes/data-migration-gaps.md`.
2. **Fill gaps.** Either extend the existing setup/migrate-v2 step scripts or write a fork-specific `setup/migrate-v2/fork-extras.ts` step that runs after the standard ones. Preserve fork-only data verbatim.
3. **Test against a production-DB backup.** Restore a copy of `~/NanoClaw/store/messages.db` into the v2-migration worktree. Run the migration end-to-end. Assert row counts match, fork-only columns survive, two-DB split is populated correctly per the architecture docs.
4. **Idempotency.** The migration must be re-runnable. If it crashes halfway, the next run must complete without duplicating data or skipping rows. Test by running twice in succession against the same input.

Phase 1 exit criteria: migration script verifiably transforms a copy of production v1 data into a valid v2 state; row counts in `data/v2.db` match expectations from `data-migration-gaps.md`; running twice in succession produces identical output.

**Rollback:** all data work happens in the v2-migration worktree against backup data; production DBs are never touched. To undo, `rm -rf /home/nanoclaw/nanoclaw-v2/data/`.

## Phase 2 — Batched porting (25-40 hours)

Goal: port all 20 rows from `phase-1-prep.md`'s queue using the hybrid mechanism. Re-specification happens per-row at the start of each row's work, NOT in a bulk re-spec phase.

Process for each row:
1. **Re-spec** under the new template (~20-30 min). Declare mechanism (`intent-port | cherry-pick | reimplement`). Embed verification command + expected output. Reference the patch file path.
2. **Red-team review** (~5 min: LiteLLM Sonnet/Flash, "find what this spec missed").
3. **Lock the spec** via `scripts/lock-spec.sh <row-id>` (auto-runs failure-mode greps).
4. **Generate the patch file** (the intent diff). Commit.
5. **Apply manually** in the v2-migration worktree. Human (Noam) approves each chunk; Claude edits.
6. **Verify** via `scripts/verify-spec-<row-id>.sh`. Must exit 0.
7. **Commit** the row's work as a single commit `[<row-id>] <subject>`.

Batches and checkpoints:

- **Batch 1 — Core WhatsApp (U1, U2, F6, CH1, CH3).** ~8-10h. Checkpoint A: `pnpm test`; manual smoke (voice, image, sticker, reactions on a registered chat).
- **Batch 2 — Telegram + shared (U1-TG, CH2).** ~3-5h. Checkpoint B: TG voice handler smoke.
- **Batch 3 — Porter-Core hardening (C1-C6, sequential per intra-batch deps).** ~8-12h. Checkpoint C: `pnpm test` + scheduled-task fabrication-detection smoke (synthesize a task that reports success without invoking tools; verify C6's guard catches it).
- **Batch 4 — Standalone features (F1-F5).** ~4-7h. Checkpoint D: each feature smoke-tested independently.
- **Batch 5 — Closeout (U4, U5a, U5c, U6).** ~2-4h. (U3 already dropped; U5b folded into channel-formatting skill upgrade in Batch 1 or 2 depending on dep order.) Checkpoint E: full test suite passes; full architecture smoke.

**Rollback at any batch:** `git reset --hard <commit-before-batch>` on v2-migration; production untouched.

## Phase 3 — Final verification + cutover (3-5 hours)

1. **Freeze v2-migration** (announce no more commits).
2. **Clean clone smoke.** In a fresh tmpdir: `git clone <fork> && cd ... && git checkout v2-migration && pnpm ci && pnpm test`. Must pass.
3. **Full manual test matrix.** All 20 rows tested end-to-end in the clean clone.
4. **Cutover (~30 min):**
   ```
   systemctl --user stop nanoclaw                             # or launchctl unload on macOS
   cd ~/NanoClaw
   git fetch origin v2-migration
   git reset --hard origin/v2-migration                       # production tree now matches v2
   pnpm ci
   pnpm exec tsx scripts/migrate-v2-data.ts                   # Phase 1 migration on production data
   systemctl --user start nanoclaw
   ```
5. **Post-cutover monitor.** Tail `logs/nanoclaw.error.log` for 30 min; send a test message in each registered channel; verify scheduled-task next-run lands correctly.

**Rollback after cutover:** `git reset --hard <pre-cutover-commit>`; restore `store/messages.db` from the backup taken in Phase 1; restart. Recovery: <5 min.

---

# What changes for existing 22 specs

The locked-2026-05-19 specs under `migration-notes/specs/` are **not directly usable** under the new mechanism. They assume `git merge skill/X` (broken). They lack verification scripts. They lack patch files. They lack the declared-mechanism field.

Re-specification happens **incrementally per-row at the start of each row's batch work** (Phase 2 step 1 above). This is preferred over a bulk re-spec phase because:

- It distributes the work across batches rather than front-loading.
- The re-spec author has fresh context from the immediately-prior row.
- If a row turns out to be dropped/merged, no wasted re-spec work.

The locked specs serve as **starting drafts** — most of the behavioral-spec content transfers verbatim; what changes is the mechanism declaration, verification script reference, and patch file reference.

Estimated re-spec overhead: ~30 min per row × 20 rows ≈ 10 hours, distributed across Phase 2 batches.

---

# Open risks

1. **Deep architectural mismatches.** A row might prove un-portable because v2's paradigm fundamentally rejects v1's approach. Mitigation: re-implement-from-spec mode (mechanism #3). Risk: time cost balloons for one or two rows.

2. **Effort escalation.** 40-65h estimate is a range, not a promise. A single row with unexpected v2-integration surprises (e.g., an F-row that needs a new MCP tool registration system) could add 5-10h. No mitigation — accept and adjust.

3. **Data migration completeness.** Phase 1's audit may surface gaps that take >6h to fill (e.g., if fork-only schema is more complex than realized). Mitigation: Phase 1 is sequenced before Phase 2 specifically so this surfaces early; Phase 2 can be re-planned if Phase 1 reveals deeper data-layer work.

4. **AI assistant fallibility (META-RISK).** I (Claude) fabricated once in this exercise. The verification discipline is designed to prevent recurrence, but it depends on me actually running `scripts/lock-spec.sh` and not bypassing it. Mitigation: the "Issue 7" guard above (must paste untruncated verification output before claiming a spec is locked) is a self-discipline rule; the user is the failsafe.

5. **Channel-fork main-branch drift during Phase 2.** Other contributors to `noamrazbuilds/nanoclaw-whatsapp` (or upstream) may push commits while Phase 2 runs. Mitigation: pin to specific commits in each row's patch file; explicit re-validation before final cutover.

6. **Spec re-specification debt.** If a row's re-spec takes 60 min instead of 30, the Phase 2 total grows by ~10h. Mitigation: pre-built `_TEMPLATE.md` (Phase 0) reduces re-spec friction; the failure-mode greps are mechanical.

7. **Gauntlet 2-voice-not-3 caveat.** This plan was synthesized from two independent 2-voice debates rather than one 3-voice debate. Cross-coverage gives 3-of-3 voices on the load-bearing decisions but the specific framings might be improvable. Mitigation: revisit if a Phase 0 or Phase 1 step surfaces evidence that contradicts the plan.

---

# Pre-flight checklist before kicking off Phase 0

- [ ] User reviews and approves this revised plan.
- [ ] `migration-notes/phase-2-spawn-issues.md` is committed (already done: `a3a2691`).
- [ ] `migration-notes/phase-2-revised-plan.md` (this doc) is committed.
- [ ] Locked 2026-05-19 specs remain intact at `migration-notes/specs/` for reference during re-specification.
- [ ] Production NanoClaw at `/home/nanoclaw/NanoClaw` is verifiably untouched (`git status` clean on `main`).
- [ ] v2-migration worktree at `/home/nanoclaw/nanoclaw-v2` is at the post-rollback commit `0b455e4` (clean).
- [ ] Memory note `project_nanoclaw_v2_upgrade.md` is updated to point at this plan as authoritative for Phase 2+.

---

# Deliverables index

When Phase 0 completes, the repo will have:

- `scripts/verify-operation.sh` — generic verification harness
- `scripts/lock-spec.sh` — pre-lock check runner
- `migration-notes/specs/_TEMPLATE.md` — canonical spec template
- `migration-notes/patches/` — directory for `.patch` artifacts
- `migration-notes/verification-outputs/` — directory for captured verification outputs
- `migration-notes/red-team-reviews/` — directory for adversarial review notes
- `migration-notes/data-migration-gaps.md` — Phase 1 audit output (added in Phase 1)
- `.claude/skills/add-whatsapp/SKILL.md` updated to fetch from `noamrazbuilds/nanoclaw-whatsapp`
- `.claude/skills/add-telegram/SKILL.md` updated similarly

When Phase 2 completes, each of the 20 rows in `phase-1-prep.md` will have:

- A re-specified `migration-notes/specs/<row-id>.md` under the new template
- A `migration-notes/patches/<row-id>.patch` capturing the intent diff
- A `scripts/verify-spec-<row-id>.sh` capturing verification
- A `migration-notes/red-team-reviews/<row-id>.md` adversarial review record
- A `migration-notes/verification-outputs/<row-id>.txt` final verification output
- One or more commits on `v2-migration` implementing the row
