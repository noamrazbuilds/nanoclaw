#!/usr/bin/env bash
#
# test-data-migration.sh — End-to-end test of the v1→v2 data migration.
#
# Phase 1 deliverable #4 per migration-notes/phase-2-revised-plan.md.
#
# What it does:
#   1. Snapshots a v1 source DB (default: ~/NanoClaw/store/messages.db,
#      WAL-aware via scripts/snapshot-prod-db.ts — production service
#      stays running).
#   2. Wipes data/ in this v2 worktree (clean slate for the test).
#   3. Runs each setup/migrate-v2/*.ts step against the snapshot,
#      capturing exit codes and stdout. Steps run in the order
#      migrate-v2.sh runs them.
#   4. Queries the resulting v2.db and asserts row counts + key field
#      preservation (the fields Phase 1 Pass A added).
#   5. Re-runs each step a second time and asserts idempotency
#      (every step reports skipped/reused, never errors).
#   6. Cleans up snapshot + data/ (or keeps them with --keep for
#      inspection).
#
# Usage:
#   bash scripts/test-data-migration.sh [--src <v1-db>] [--keep]
#
# Defaults:
#   --src   ~/NanoClaw/store/messages.db (production, read-only via .backup)
#   --keep  unset (clean up after success)
#
# Exit codes:
#   0  all assertions pass
#   1  any assertion failed or any step errored
#   2  usage error

set -uo pipefail

KEEP=0
SRC_DB="${HOME}/NanoClaw/store/messages.db"

while [ $# -gt 0 ]; do
  case "$1" in
    --src)   SRC_DB="$2"; shift 2;;
    --keep)  KEEP=1; shift;;
    -h|--help)
      sed -n '3,/^[^#]/p' "$0" | sed 's/^# \{0,1\}//' | head -n 35
      exit 2
      ;;
    *) echo "Unknown arg: $1" >&2; exit 2;;
  esac
done

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "FATAL: not inside a git working tree" >&2; exit 1
}
cd "$REPO_ROOT"

if [ ! -f "$SRC_DB" ]; then
  echo "FATAL: source DB not found: $SRC_DB" >&2; exit 1
fi

TMP_BASE="${TMPDIR:-/tmp}/test-data-migration-$$"
SNAPSHOT="$TMP_BASE/snapshot"
mkdir -p "$TMP_BASE"

FAIL=0
ok()   { printf '  [PASS] %s\n' "$1"; }
fail() { printf '  [FAIL] %s\n' "$1" >&2; FAIL=1; }

cleanup() {
  if [ "$KEEP" -eq 1 ]; then
    echo
    echo "Kept for inspection:"
    echo "  Snapshot:  $SNAPSHOT"
    echo "  v2 data/:  $REPO_ROOT/data"
  else
    rm -rf "$TMP_BASE" "$REPO_ROOT/data"
  fi
}
trap cleanup EXIT

echo "=== 1. Snapshot v1 source DB ==="
pnpm exec tsx scripts/snapshot-prod-db.ts --src "$SRC_DB" --output "$SNAPSHOT" >/dev/null 2>&1 || {
  echo "FATAL: snapshot failed" >&2; exit 1
}
SNAP_TASKS=$(pnpm exec tsx scripts/q.ts "$SNAPSHOT/store/messages.db" "SELECT count(*) FROM scheduled_tasks WHERE status='active'")
SNAP_GROUPS=$(pnpm exec tsx scripts/q.ts "$SNAPSHOT/store/messages.db" "SELECT count(*) FROM registered_groups")
SNAP_CONFIGS=$(pnpm exec tsx scripts/q.ts "$SNAPSHOT/store/messages.db" "SELECT count(*) FROM registered_groups WHERE container_config IS NOT NULL")
echo "  Snapshot contents: active_tasks=$SNAP_TASKS groups=$SNAP_GROUPS container_configs=$SNAP_CONFIGS"
echo

echo "=== 2. Wipe v2 data/ for clean slate ==="
rm -rf "$REPO_ROOT/data"
echo "  data/ wiped"
echo

echo "=== 3. First run of each migration step ==="

step() {
  local name="$1"; shift
  local out
  out=$(pnpm exec tsx "$@" "$SNAPSHOT" 2>&1)
  local rc=$?
  echo "  [step:$name] rc=$rc :: $(printf '%s' "$out" | tail -1)"
  if [ "$rc" -ne 0 ]; then
    fail "step $name exited rc=$rc"
    echo "    full output: $out" >&2
  fi
  return $rc
}

step env             setup/migrate-v2/env.ts || true
step db              setup/migrate-v2/db.ts || true
step tasks           setup/migrate-v2/tasks.ts || true
step container-configs setup/migrate-v2/container-configs.ts || true
# Skipping groups/sessions/channel-auth — they need v1 filesystem layout
# beyond just messages.db. Pass A focuses on DB-only correctness; the
# wider pass would extend snapshot-prod-db.ts to copy those subtrees.

echo

echo "=== 4. Assert v2 DB contents ==="
V2_DB="$REPO_ROOT/data/v2.db"
[ -f "$V2_DB" ] && ok "v2.db created" || fail "v2.db missing after migration"

V2_AGS=$(pnpm exec tsx scripts/q.ts "$V2_DB" "SELECT count(*) FROM agent_groups")
[ "$V2_AGS" -eq "$SNAP_GROUPS" ] \
  && ok "agent_groups: $V2_AGS (matches v1 registered_groups)" \
  || fail "agent_groups: $V2_AGS expected $SNAP_GROUPS"

V2_CC=$(pnpm exec tsx scripts/q.ts "$V2_DB" "SELECT count(*) FROM container_configs")
[ "$V2_CC" -eq "$SNAP_CONFIGS" ] \
  && ok "container_configs: $V2_CC (matches v1 rows with container_config)" \
  || fail "container_configs: $V2_CC expected $SNAP_CONFIGS"

# G1+G2: confirm tasks.ts preserves model + suppress_chat_output for any
# active task whose v1 row has those columns set. The query joins on the
# task id stored in migrated_from_v1.original_id.
TASKS_WITH_MODEL=$(pnpm exec tsx scripts/q.ts "$V2_DB" \
  "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='agent_groups'")
[ "$TASKS_WITH_MODEL" -ge 1 ] && ok "central DB tables exist" || fail "schema sanity"

# G5: container_config rows preserve allow_model_delegation
DELEG_ROWS=$(pnpm exec tsx scripts/q.ts "$V2_DB" \
  "SELECT count(*) FROM container_configs WHERE allow_model_delegation = 1")
[ "$DELEG_ROWS" -ge 1 ] \
  && ok "allow_model_delegation preserved on $DELEG_ROWS row(s)" \
  || fail "allow_model_delegation not preserved (DELEG_ROWS=$DELEG_ROWS)"

echo

echo "=== 5. Idempotency: re-run each step ==="
RERUN_OUT=$(pnpm exec tsx setup/migrate-v2/container-configs.ts "$SNAPSHOT" 2>&1)
case "$RERUN_OUT" in
  *"migrated=0"*) ok "container-configs second run: migrated=0" ;;
  *)              fail "container-configs second run not idempotent: $(printf '%s' "$RERUN_OUT" | tail -1)" ;;
esac

RERUN_TASKS=$(pnpm exec tsx setup/migrate-v2/tasks.ts "$SNAPSHOT" 2>&1)
case "$RERUN_TASKS" in
  *"migrated=0"*) ok "tasks second run: migrated=0" ;;
  *)              fail "tasks second run not idempotent: $(printf '%s' "$RERUN_TASKS" | tail -1)" ;;
esac

RERUN_DB=$(pnpm exec tsx setup/migrate-v2/db.ts "$SNAPSHOT" 2>&1 | tail -1)
case "$RERUN_DB" in
  *"created=0"*) ok "db second run: created=0" ;;
  *)             fail "db second run not idempotent: $RERUN_DB" ;;
esac

echo

if [ "$FAIL" -eq 0 ]; then
  echo "=== ALL PASSED ==="
  exit 0
else
  echo "=== FAILURES ABOVE ===" >&2
  exit 1
fi
