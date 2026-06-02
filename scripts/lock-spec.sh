#!/usr/bin/env bash
#
# lock-spec.sh — Pre-lock check runner for migration specs.
#
# Refuses to mark a spec "locked" unless all anti-fabrication checks pass.
# Each check maps to a specific failure mode documented in
# migration-notes/phase-2-spawn-issues.md.
#
# Usage:  lock-spec.sh <row-id>
#
# Checks run (in order):
#   1. Spec file exists at migration-notes/specs/*/<row-id>.md
#   2. (Issue 1) No `git merge .+skill/` instruction text — the merge
#      framing was the original Phase 2 attempt #1 failure mechanism.
#   3. (Issue 2) No `(merge-tree|cherry-pick|apply) ... | (head|tail|sed)`
#      patterns — verification claims must not be truncated. This is the
#      exact fabrication mode I (Claude) demonstrated; cannot reoccur
#      structurally if specs never contain such patterns.
#   4. (Issue 3) If the spec asserts "fork-only" anything, it must also
#      contain a `git show ` or `git log ` verification command —
#      ensures claims are reproducibly checkable.
#   5. Spec declares a mechanism: `mechanism: (intent-port|cherry-pick|reimplement)`.
#   6. Patch file referenced in the spec exists at
#      migration-notes/patches/<row-id>.patch (skipped if mechanism is
#      `reimplement`).
#   7. Verify script exists at scripts/verify-spec-<row-id>.sh
#      AND its first invocation exits 0 against the locked expected
#      output the spec references.
#   8. (Warning, non-blocking) Red-team review exists at
#      migration-notes/red-team-reviews/<row-id>.md.
#
# Exit codes:
#   0  All blocking checks pass — spec is lockable.
#   1  One or more blocking checks failed — spec NOT lockable. Reasons
#      printed to stderr.
#   2  Usage error.

set -euo pipefail

ROW_ID="${1:-}"
if [ -z "$ROW_ID" ]; then
  echo "Usage: $0 <row-id>" >&2
  echo "Example: $0 U1" >&2
  exit 2
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "FATAL: not inside a git working tree" >&2; exit 1
}
cd "$REPO_ROOT"

FAIL=0
note()  { printf '  [%s] %s\n' "$1" "$2"; }
pass()  { note OK "$1"; }
warn()  { note WARN "$1"; }
fail()  { note FAIL "$1" >&2; FAIL=1; }

echo "Lock-spec check for row: $ROW_ID"

# --- 1. Locate the spec file ---
SPEC_FILE=""
for d in porter-utils porter-core porter-channels porter-features; do
  candidate="migration-notes/specs/$d/$ROW_ID.md"
  if [ -f "$candidate" ]; then SPEC_FILE="$candidate"; break; fi
done
if [ -z "$SPEC_FILE" ]; then
  fail "spec file not found under migration-notes/specs/*/$ROW_ID.md"
  exit 1
fi
pass "spec file: $SPEC_FILE"

# --- 2. (Issue 1) No `git merge .*skill/` ---
HITS_MERGE_SKILL=$(grep -nE 'git merge [^|;&]*skill/' "$SPEC_FILE" || true)
if [ -n "$HITS_MERGE_SKILL" ]; then
  fail "Issue 1 — spec contains 'git merge ... skill/' instructions (use cherry-pick or intent-port):"
  printf '%s\n' "$HITS_MERGE_SKILL" | sed 's/^/      /' >&2
else
  pass "Issue 1 — no 'git merge skill/' patterns"
fi

# --- 3. (Issue 2) No truncation of verification output ---
# Look for merge-tree / cherry-pick / apply followed by a pipe to
# head/tail/sed/awk. Exception: `wc -l` or `wc -c` after pipe is OK
# because those *count* the full output rather than truncate it.
HITS_TRUNC=$(grep -nE '(merge-tree|cherry-pick|git apply|git diff)[^|]*\|[[:space:]]*(head|tail|sed|awk)\b' "$SPEC_FILE" || true)
if [ -n "$HITS_TRUNC" ]; then
  fail "Issue 2 — spec contains truncated verification output (no | head/tail/sed/awk on merge-tree/cherry-pick/apply/diff):"
  printf '%s\n' "$HITS_TRUNC" | sed 's/^/      /' >&2
else
  pass "Issue 2 — no truncating pipes on verification commands"
fi

# --- 4. (Issue 3) Fork-only claims need verification commands ---
FORK_ONLY_HITS=$(grep -cE 'fork-only|fork only' "$SPEC_FILE" || true)
if [ "$FORK_ONLY_HITS" -gt 0 ]; then
  # Heuristic: if the spec mentions fork-only, it should also contain
  # a `git show ` or `git log ` command that verifies the claim.
  GIT_VERIFY_HITS=$(grep -cE '`git (show|log|grep|ls-tree) ' "$SPEC_FILE" || true)
  if [ "$GIT_VERIFY_HITS" -eq 0 ]; then
    fail "Issue 3 — spec asserts 'fork-only' (${FORK_ONLY_HITS} mention(s)) but contains no git show / git log / git grep / git ls-tree verification command"
  else
    pass "Issue 3 — fork-only claims (${FORK_ONLY_HITS}) accompanied by ${GIT_VERIFY_HITS} git verification command(s)"
  fi
else
  pass "Issue 3 — no 'fork-only' claims to verify"
fi

# --- 5. Mechanism declaration ---
MECHANISM=""
MECH_LINE=$(grep -iE '^[*-][[:space:]]+(\*\*)?mechanism' "$SPEC_FILE" || true)
case "$MECH_LINE" in
  *intent-port*)     MECHANISM="intent-port" ;;
  *cherry-pick*)     MECHANISM="cherry-pick" ;;
  *reimplement*)     MECHANISM="reimplement" ;;
esac
if [ -z "$MECHANISM" ]; then
  fail "no mechanism declared. Expected a line like '- **mechanism:** intent-port' (or cherry-pick / reimplement) at the top of the spec."
else
  pass "mechanism: $MECHANISM"
fi

# --- 6. Patch file (skip if reimplement) ---
PATCH_FILE="migration-notes/patches/$ROW_ID.patch"
if [ "$MECHANISM" = "reimplement" ]; then
  pass "patch check skipped (mechanism is reimplement)"
elif [ -n "$MECHANISM" ]; then
  if [ -f "$PATCH_FILE" ]; then
    if [ -s "$PATCH_FILE" ]; then
      pass "patch present: $PATCH_FILE ($(wc -l < "$PATCH_FILE") lines)"
    else
      fail "patch present but empty: $PATCH_FILE"
    fi
  else
    fail "patch missing: $PATCH_FILE"
  fi
fi

# --- 7. Verify script + run ---
VERIFY_SCRIPT="scripts/verify-spec-$ROW_ID.sh"
if [ -f "$VERIFY_SCRIPT" ]; then
  if [ -x "$VERIFY_SCRIPT" ]; then
    pass "verify script present + executable: $VERIFY_SCRIPT"
    # Try to run it. Capture exit code without leaking output to stdout —
    # the script itself is responsible for diff-reporting on failure.
    set +e
    bash "$VERIFY_SCRIPT" >/dev/null 2>&1
    VRC=$?
    set -e
    if [ "$VRC" -eq 0 ]; then
      pass "verify script exits 0 — verification succeeded"
    else
      fail "verify script exits $VRC — verification failed. Re-run '$VERIFY_SCRIPT' to see diff."
    fi
  else
    fail "verify script not executable: $VERIFY_SCRIPT (run chmod +x)"
  fi
else
  fail "verify script missing: $VERIFY_SCRIPT"
fi

# --- 8. Red-team review (warning only) ---
RT_REVIEW="migration-notes/red-team-reviews/$ROW_ID.md"
if [ -f "$RT_REVIEW" ]; then
  pass "red-team review present: $RT_REVIEW"
else
  warn "red-team review not found at $RT_REVIEW — strongly recommended before lock"
fi

# --- Summary ---
echo
if [ "$FAIL" -eq 0 ]; then
  echo "✓ Spec $ROW_ID is LOCKABLE."
  exit 0
else
  echo "✗ Spec $ROW_ID is NOT lockable — see [FAIL] lines above."
  exit 1
fi
