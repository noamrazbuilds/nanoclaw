#!/usr/bin/env bash
#
# setup-porter-worktree.sh — Create a per-row porter worktree on demand.
#
# Phase 0 deliverable #5 per migration-notes/phase-2-revised-plan.md.
#
# Why this exists:
#   Claude Code's `isolation: worktree` Agent flag isolates the SESSION's
#   anchor repo, which in this setup is /home/nanoclaw/NanoClaw (production),
#   not /home/nanoclaw/nanoclaw-v2 (migration). The Phase 2 attempt #1
#   Porter discovered this the hard way — its CWD ended up being a
#   worktree of the production repo with no migration-notes/, no v2 source.
#
#   This script pre-creates a worktree of *nanoclaw-v2's* .git, on a
#   per-row branch, so a Porter can be spawned without isolation and
#   pointed at this concrete path. Each row gets its own worktree +
#   branch so multiple Porters can run in parallel (Phase 2 batches 3-5)
#   without colliding on the v2-migration branch.
#
# Usage:
#   setup-porter-worktree.sh <row-id> [--base <ref>] [--path <dir>]
#
# Defaults:
#   --base  v2-migration  (the branch new porter branches are forked off)
#   --path  /home/nanoclaw/nanoclaw-v2-porter-<row-id>
#
# Behavior:
#   - If the worktree path already exists and is the registered worktree
#     for `porter-<row-id>`, prints the path and exits 0 (idempotent).
#   - If the worktree path exists but isn't a git worktree of this repo,
#     exits 1 with an error.
#   - If the branch `porter-<row-id>` exists but isn't checked out
#     anywhere, creates the worktree at it (recovers from prior cleanup).
#   - Otherwise creates branch `porter-<row-id>` from --base and a new
#     worktree at --path.
#
# After Porter work completes (manual cleanup; this script does NOT auto-
# tear-down to avoid losing work):
#   cd /home/nanoclaw/nanoclaw-v2
#   git merge porter-<row-id>                    # if merging to v2-migration
#   git worktree remove /home/nanoclaw/nanoclaw-v2-porter-<row-id>
#   git branch -d porter-<row-id>                # only if merged
#
# Exit codes:
#   0  worktree ready at the printed path
#   1  precondition or conflict failure
#   2  usage error

set -euo pipefail

ROW_ID=""
BASE_REF="v2-migration"
WORKTREE_PATH=""

while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE_REF="$2"; shift 2;;
    --path) WORKTREE_PATH="$2"; shift 2;;
    -h|--help)
      sed -n '3,/^[^#]/p' "$0" | sed 's/^# \{0,1\}//' | head -n 50
      exit 2
      ;;
    --*)    echo "Unknown option: $1" >&2; exit 2;;
    *)
      if [ -z "$ROW_ID" ]; then ROW_ID="$1"; shift
      else echo "Unexpected positional arg: $1" >&2; exit 2
      fi
      ;;
  esac
done

if [ -z "$ROW_ID" ]; then
  echo "Usage: $0 <row-id> [--base <ref>] [--path <dir>]" >&2
  echo "Example: $0 U1" >&2
  exit 2
fi

# Default worktree path uses HOME so the script works regardless of cwd.
if [ -z "$WORKTREE_PATH" ]; then
  WORKTREE_PATH="${HOME}/nanoclaw-v2-porter-${ROW_ID}"
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "FATAL: not inside a git working tree" >&2; exit 1
}
cd "$REPO_ROOT"

BRANCH="porter-${ROW_ID}"

# Idempotency: if a worktree for this branch is already registered, use it.
EXISTING_PATH=$(git worktree list --porcelain | awk -v b="refs/heads/$BRANCH" '
  $1=="worktree" { p=$2 }
  $1=="branch"   { if ($2==b) { print p; exit } }
')

if [ -n "$EXISTING_PATH" ]; then
  if [ "$EXISTING_PATH" = "$WORKTREE_PATH" ]; then
    echo "Already configured: $WORKTREE_PATH (branch: $BRANCH)" >&2
    echo "$WORKTREE_PATH"
    exit 0
  else
    echo "FATAL: branch '$BRANCH' is already checked out at $EXISTING_PATH" >&2
    echo "       (requested path was $WORKTREE_PATH)" >&2
    echo "       Either reuse the existing path or remove the worktree first:" >&2
    echo "         git worktree remove $EXISTING_PATH" >&2
    exit 1
  fi
fi

# Path conflict check.
if [ -e "$WORKTREE_PATH" ]; then
  echo "FATAL: $WORKTREE_PATH already exists and isn't a registered worktree for $BRANCH" >&2
  exit 1
fi

# Verify the base ref exists.
if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  echo "FATAL: base ref '$BASE_REF' does not exist locally" >&2
  echo "       Did you mean 'origin/$BASE_REF'? Try: git fetch origin" >&2
  exit 1
fi

# Branch existence handling.
if git rev-parse --verify "refs/heads/$BRANCH" >/dev/null 2>&1; then
  # Branch exists but isn't a worktree — recover by adding worktree at it.
  echo "Branch $BRANCH exists; attaching worktree at $WORKTREE_PATH" >&2
  git worktree add "$WORKTREE_PATH" "$BRANCH"
else
  # Fresh branch off the base ref.
  echo "Creating branch $BRANCH off $BASE_REF; worktree at $WORKTREE_PATH" >&2
  git worktree add -b "$BRANCH" "$WORKTREE_PATH" "$BASE_REF"
fi

# Sanity check: the new worktree should have a valid checkout.
if [ ! -d "$WORKTREE_PATH/.git" ] && [ ! -f "$WORKTREE_PATH/.git" ]; then
  echo "FATAL: worktree creation succeeded but $WORKTREE_PATH has no .git" >&2
  exit 1
fi

cat >&2 <<NOTE

Porter worktree ready.

  Path:   $WORKTREE_PATH
  Branch: $BRANCH (off $BASE_REF)

Spawn a Porter pointed here. Do NOT use isolation: worktree (it would
isolate the wrong repo). Use Bash directly or invoke an Agent without
isolation, and pass the worktree path as the working dir.

Cleanup when done (after merging back to $BASE_REF):
  git -C $REPO_ROOT merge $BRANCH
  git worktree remove $WORKTREE_PATH
  git branch -d $BRANCH

NOTE

echo "$WORKTREE_PATH"
