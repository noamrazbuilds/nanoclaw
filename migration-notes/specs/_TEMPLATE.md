# <ROW_ID> — <short row title>

> **THIS IS A TEMPLATE, not a lockable spec.** Copy to `migration-notes/specs/porter-<category>/<ROW_ID>.md` and fill in. Each section below has filling instructions in HTML comments — strip them when done.

- **mechanism:** intent-port | cherry-pick | reimplement <!-- pick one; declared explicitly so `scripts/lock-spec.sh` can route to the right artifact -->

## Source (v1)
<!-- Cite the exact path under docs/v1-fork-reference/ (the stashed v1 source) and the LOC range. Include origin commit hash if known. -->
- Primary: `docs/v1-fork-reference/src/<file>.ts` (<LOC>; exports …)
- Call site(s): `docs/v1-fork-reference/src/channels/<file>.ts:<line>-<line>`
- Origin commits: `<hash>` (<one-line subject>)

## Behavioral spec (one paragraph)
<!-- Describe the user-visible behavior: when it fires, what it does, what data it touches, what the success and failure outputs look like. Keep to a single paragraph. End with "The reason: ..." giving the rationale for preserving the feature in v2. This paragraph is the source of truth if the v1 code or v2 implementation drifts. -->

When <trigger condition>, the system <action>, producing <observable output>. <Detail about edge cases / fallback behavior>. The reason: <rationale>.

## v2 hook point(s)
<!-- File paths in v2 where the new code lands. Be specific: line numbers if known, file shape if the file doesn't exist yet. If mechanism is cherry-pick, name the exact commit hash being applied. If intent-port, name the diff-source command. If reimplement, say "fresh implementation; v1 source for behavior only". -->

- v2 core: `src/<file>.ts` — <what changes>
- Channel fork worktree (if any): `<path>` on branch `<branch>`
- Backend script / migration / config (if any): `<path>`

## v2-native equivalent that might suffice?
<!-- EXISTS-NATIVELY / PARTIAL-OVERLAP / DOES-NOT-EXIST. If PARTIAL, what's the gap. If EXISTS, why are we still touching it (probably to wire it through; rare). The point of this section is to prevent "we ported something v2 already has" wastage. -->

**EXISTS-NATIVELY | PARTIAL-OVERLAP (~XX%) | DOES-NOT-EXIST.** <Evidence: file paths or `git show` commands a reader can re-run to confirm the verdict>.

## Verification artifact
<!-- This is the new section that replaces "Confirm at spec extraction" prose. Point at the verification script and the captured expected output. The verify script for a row lives at scripts/verify-spec-<ROW_ID>.sh and produces output at migration-notes/verification-outputs/<ROW_ID>.txt — both committed. -->

- Script: `scripts/verify-spec-<ROW_ID>.sh` (wraps `scripts/verify-operation.sh`)
- Expected output: `migration-notes/verification-outputs/<ROW_ID>.txt`
- Patch file (if mechanism is intent-port or cherry-pick): `migration-notes/patches/<ROW_ID>.patch`
- Captured on: <YYYY-MM-DD> against base ref `<branch>@<short-sha>`
- Re-run command: `bash scripts/verify-spec-<ROW_ID>.sh`

## Decisions / open questions
<!-- One numbered item per decision the spec author had to make. State the decision, the rationale, and what would change the decision later. -->

1. **<question>:** <answer> (<rationale>). Revisit if <condition>.

## Notes for Porter
<!-- Mechanical instructions: branch to be on, what command runs, what to do if verification deviates. -->

- Working tree: <which worktree to operate in>
- Pre-flight: `bash scripts/lock-spec.sh <ROW_ID>` must exit 0 before any porting action.
- Apply: `bash scripts/verify-spec-<ROW_ID>.sh` to re-verify; manual application of patch + commit per the plan's "Process for each row".
- On deviation: STOP. Do not improvise. Report the diff to the user.

---

## Implementation notes (delete from real specs)

- **Lock-spec self-check:** `scripts/lock-spec.sh _TEMPLATE` will FAIL because the template's row-id doesn't resolve to a real spec under `porter-*/` and there's no patch / verify script. That's intentional — the template documents the format; the script verifies real specs. The Phase 0 exit-criteria line "template self-verifies" in `phase-2-revised-plan.md` was an unrealistic over-promise; treat it as "the script exists and runs cleanly against real specs."
- **Mechanism choice guide:**
  - `intent-port` (default): for changes that conflict with v2's evolution or require judgment. Generate the diff via `git diff $(git merge-base v2-migration <v1-feature-commit>)...<v1-feature-commit>`, save to `migration-notes/patches/`, port manually.
  - `cherry-pick`: only for clean commits where verification shows ≤1 expected, named conflict file in the captured output. The vast majority of skill-branch feature commits do NOT qualify.
  - `reimplement`: for architectural mismatches where v2's paradigm differs from v1's (e.g., a feature replaced by a v2 skill). Fresh implementation from behavioral spec only; v1 source is reference, not template.
- **Why these sections in this order:** Source → Behavior → Hook → Native-overlap → Verification → Decisions → Notes. Lets a reader build the model bottom-up; the verification artifact section is the byte-for-byte contract that the Porter has to honor.
