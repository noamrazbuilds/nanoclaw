#!/usr/bin/env bash
#
# verify-operation.sh — Generic verification harness for migration specs.
#
# Captures untruncated output of a git operation in dry-run mode and
# (optionally) compares it byte-for-byte against an expected-output file.
# Exists to prevent the truncation fabrication pattern documented in
# migration-notes/phase-2-spawn-issues.md Issue 2.
#
# Usage:
#   verify-operation.sh --op <type> --row-id <id> [--ref <ref>] [--base <ref>]
#                       [--patch <file>] [--expected <file>] [--out-dir <dir>]
#
# Operation types:
#   merge-tree         Run `git merge-tree --write-tree <base> <ref>`. True
#                      dry-run; never modifies working tree. Best for
#                      simulating cherry-pick conflicts.
#
#   cherry-pick-dry    Run `git cherry-pick --no-commit <ref>` then abort.
#                      Closer to a real run but mutates index momentarily.
#                      Requires a clean working tree.
#
#   apply-check        Run `git apply --check <patch>`. Validates a patch
#                      would apply cleanly without applying it.
#
# Output format (deterministic — diff-friendly):
#   === COMMAND ===
#   <exact command run>
#   === EXIT CODE ===
#   <integer>
#   === STDOUT ===
#   <full stdout>
#   === STDERR ===
#   <full stderr>
#   === GIT STATUS --PORCELAIN ===
#   <git status output post-op>
#
# Always writes the capture to <out-dir>/<row-id>.txt.
#
# Exit codes:
#   0  Capture produced. If --expected given, capture matched byte-for-byte.
#   1  Capture produced. If --expected given, capture differed; diff shown.
#   2  Usage error / missing arg.
#   3  Pre-flight failed (working tree dirty for cherry-pick-dry, etc.).
#
# Prohibited internally:
#   No `| head`, `| tail`, `| grep`, `| awk`, `| sed`, `| cut` on the
#   primary command's output. The whole point is preserving full output.
#   The script enforces this on itself with a self-grep at the top.

set -euo pipefail

SCRIPT_PATH="${BASH_SOURCE[0]}"
SCRIPT_NAME="$(basename "$SCRIPT_PATH")"

# Self-check: this script must not pipe primary capture through truncating tools.
# We allow `head`/`tail`/etc. only inside comments or strings (skipped here).
self_check() {
  local hits
  hits=$(awk '
    /^[[:space:]]*#/ { next }
    /capture[._-]?cmd|primary[._-]?out|main[._-]?capture/ &&
      /\|[[:space:]]*(head|tail|grep|awk|sed|cut)\b/ { print NR": "$0 }
  ' "$SCRIPT_PATH" || true)
  if [ -n "$hits" ]; then
    echo "FATAL: $SCRIPT_NAME contains truncating pipe on a primary capture:" >&2
    echo "$hits" >&2
    exit 2
  fi
}
self_check

usage() {
  sed -n '3,/^[^#]/p' "$SCRIPT_PATH" | sed 's/^# \{0,1\}//' | head -n 40
  exit 2
}

# Defaults
OP=""
ROW_ID=""
REF=""
BASE=""
PATCH=""
EXPECTED=""
OUT_DIR="migration-notes/verification-outputs"

while [ $# -gt 0 ]; do
  case "$1" in
    --op)        OP="$2"; shift 2;;
    --row-id)    ROW_ID="$2"; shift 2;;
    --ref)       REF="$2"; shift 2;;
    --base)      BASE="$2"; shift 2;;
    --patch)     PATCH="$2"; shift 2;;
    --expected)  EXPECTED="$2"; shift 2;;
    --out-dir)   OUT_DIR="$2"; shift 2;;
    -h|--help)   usage;;
    *)           echo "Unknown arg: $1" >&2; usage;;
  esac
done

[ -n "$OP" ]      || { echo "Missing --op" >&2; usage; }
[ -n "$ROW_ID" ]  || { echo "Missing --row-id" >&2; usage; }

# Resolve repo root and verify we're inside a git tree.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "FATAL: not inside a git working tree" >&2; exit 3
}
cd "$REPO_ROOT"

# Resolve the actual git directory (handles worktrees where .git is a file).
GIT_DIR="$(git rev-parse --git-dir)"

mkdir -p "$OUT_DIR"
OUT_FILE="$OUT_DIR/${ROW_ID}.txt"

# Build the command to run, per op type.
case "$OP" in
  merge-tree)
    [ -n "$REF" ]  || { echo "--ref required for merge-tree" >&2; exit 2; }
    [ -n "$BASE" ] || { echo "--base required for merge-tree" >&2; exit 2; }
    CMD=(git merge-tree --write-tree "$BASE" "$REF")
    NEEDS_CLEAN_TREE=0
    NEEDS_ABORT=0
    ;;
  cherry-pick-dry)
    [ -n "$REF" ] || { echo "--ref required for cherry-pick-dry" >&2; exit 2; }
    CMD=(git cherry-pick --no-commit "$REF")
    NEEDS_CLEAN_TREE=1
    NEEDS_ABORT=1
    ;;
  apply-check)
    [ -n "$PATCH" ] || { echo "--patch required for apply-check" >&2; exit 2; }
    [ -f "$PATCH" ] || { echo "Patch file not found: $PATCH" >&2; exit 3; }
    CMD=(git apply --check --verbose "$PATCH")
    NEEDS_CLEAN_TREE=0
    NEEDS_ABORT=0
    ;;
  *)
    echo "Unknown op: $OP" >&2
    usage
    ;;
esac

# Pre-flight: dirty-tree check for ops that mutate the index.
if [ "$NEEDS_CLEAN_TREE" -eq 1 ]; then
  if [ -n "$(git status --porcelain)" ]; then
    echo "FATAL: working tree must be clean for op '$OP'" >&2
    git status --short >&2
    exit 3
  fi
fi

# Run the command. Capture stdout + stderr separately so we can record
# both in the output file deterministically. Use temp files (mktemp) —
# never pipe primary output through head/tail/grep.
TMP_OUT="$(mktemp)"
TMP_ERR="$(mktemp)"
trap 'rm -f "$TMP_OUT" "$TMP_ERR"' EXIT

set +e
"${CMD[@]}" >"$TMP_OUT" 2>"$TMP_ERR"
EXIT_CODE=$?
set -e

# Capture git status before any abort/cleanup.
TMP_STATUS="$(mktemp)"
git status --porcelain >"$TMP_STATUS" 2>&1 || true

# Abort any partial cherry-pick + fully reset the working tree to the
# pre-op state. `git cherry-pick --abort` alone leaves unmerged index
# entries when conflicts occurred; `git reset --hard HEAD` is safe here
# because the NEEDS_CLEAN_TREE precondition guarantees HEAD == pre-op
# state.
if [ "$NEEDS_ABORT" -eq 1 ]; then
  if [ -f "$GIT_DIR/CHERRY_PICK_HEAD" ] || [ -d "$GIT_DIR/sequencer" ]; then
    git cherry-pick --abort >/dev/null 2>&1 || true
  fi
  # Reset hard regardless — covers the case where abort succeeded but
  # left unmerged paths behind (observed with `--no-commit` on heavy
  # conflict sets). Safe because of the precondition above.
  git reset --hard HEAD >/dev/null 2>&1 || true
fi

# Build the capture file. Deterministic structure for byte-for-byte diff.
{
  echo "=== COMMAND ==="
  printf '%s' "${CMD[0]}"
  for arg in "${CMD[@]:1}"; do printf ' %q' "$arg"; done
  echo
  echo "=== EXIT CODE ==="
  echo "$EXIT_CODE"
  echo "=== STDOUT ==="
  cat "$TMP_OUT"
  echo "=== STDERR ==="
  cat "$TMP_ERR"
  echo "=== GIT STATUS --PORCELAIN ==="
  cat "$TMP_STATUS"
} > "$OUT_FILE"

rm -f "$TMP_STATUS"

echo "Capture written: $OUT_FILE ($(wc -l < "$OUT_FILE") lines)" >&2

# If no --expected given, we're done. Print the capture path and exit 0.
if [ -z "$EXPECTED" ]; then
  echo "$OUT_FILE"
  exit 0
fi

# Byte-for-byte comparison. diff exit 0 = match, 1 = differ.
if diff -u "$EXPECTED" "$OUT_FILE" >/dev/null 2>&1; then
  echo "VERIFIED: $OUT_FILE matches $EXPECTED" >&2
  echo "$OUT_FILE"
  exit 0
else
  echo "DEVIATION: $OUT_FILE differs from $EXPECTED" >&2
  echo "---DIFF (expected vs actual)---" >&2
  diff -u "$EXPECTED" "$OUT_FILE" >&2 || true
  echo "---END DIFF---" >&2
  exit 1
fi
