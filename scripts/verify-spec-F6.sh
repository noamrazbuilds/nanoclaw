#!/usr/bin/env bash
#
# verify-spec-F6.sh — Phase 2 verification for F6 (inbound + outbound WhatsApp
# reactions). Content/snippet-based plus a real host+container typecheck of the
# porter worktree. The reactions port adds NO new dependencies, so the lockfiles
# must be byte-identical to whatsapp-fork/main (an added dep would be a red flag).

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "FATAL: not inside a git working tree" >&2; exit 1
}
cd "$REPO_ROOT"

WORKTREE="/home/nanoclaw/nanoclaw-v2-porter-F6"
EXPECTED_BRANCH="porter-F6"
BASE_REF="whatsapp-fork/main"

FAIL=0
note() { printf '  [%s] %s\n' "$1" "$2"; }
ok()   { note OK   "$1"; }
fail() { note FAIL "$1" >&2; FAIL=1; }

echo "Verifying F6..."

# 1. Worktree presence + branch
if [ ! -d "$WORKTREE" ]; then
  fail "porter worktree missing at $WORKTREE"
else
  BRANCH=$(git -C "$WORKTREE" rev-parse --abbrev-ref HEAD)
  if [ "$BRANCH" = "$EXPECTED_BRANCH" ]; then
    ok "porter worktree on branch $BRANCH"
  else
    fail "porter worktree on wrong branch: $BRANCH (expected $EXPECTED_BRANCH)"
  fi
fi

# Helper: assert a file in the worktree contains a regex.
check_snippet() {
  local file="$1"; local label="$2"; local pattern="$3"
  local full="$WORKTREE/$file"
  if [ ! -f "$full" ]; then
    fail "$file missing"
    return
  fi
  if grep -qE "$pattern" "$full"; then
    ok "$file contains: $label"
  else
    fail "$file missing: $label"
  fi
}

# 2. DB layer — reactions table, write/read, message helpers.
check_snippet "src/db.ts" "reactions table"        "CREATE TABLE IF NOT EXISTS reactions"
check_snippet "src/db.ts" "composite PK"           "PRIMARY KEY \\(message_id, message_chat_jid, reactor_jid\\)"
check_snippet "src/db.ts" "Reaction interface"     "export interface Reaction"
check_snippet "src/db.ts" "storeReaction"          "export function storeReaction"
check_snippet "src/db.ts" "DELETE-on-empty"        "DELETE FROM reactions WHERE message_id"
check_snippet "src/db.ts" "getLatestMessage"       "export function getLatestMessage"
check_snippet "src/db.ts" "getMessageFromMe"       "export function getMessageFromMe"

# 3. WhatsApp adapter — inbound listener + outbound send (this is the one file
#    a v2 install actually fetches from the fork; see spec open-question #1).
check_snippet "src/channels/whatsapp.ts" "storeReaction import" "^[[:space:]]*storeReaction,"
check_snippet "src/channels/whatsapp.ts" "getLatestMessage import" "^[[:space:]]*getLatestMessage,"
check_snippet "src/channels/whatsapp.ts" "reaction listener"   "messages\\.reaction"
check_snippet "src/channels/whatsapp.ts" "sendReaction method" "async sendReaction\\("
check_snippet "src/channels/whatsapp.ts" "reactToLatestMessage" "async reactToLatestMessage\\("
check_snippet "src/channels/whatsapp.ts" "react payload"       "react: \\{ text: emoji, key: messageKey \\}"

# 4. Channel interface — optional reaction methods.
check_snippet "src/types.ts" "Channel.sendReaction" "sendReaction\\?\\("
check_snippet "src/types.ts" "Channel.reactToLatestMessage" "reactToLatestMessage\\?\\("

# 5. Host IPC — reaction routing branch + dep.
check_snippet "src/ipc.ts" "IpcDeps.sendReaction" "sendReaction\\?: \\("
check_snippet "src/ipc.ts" "reaction branch"      "data\\.type === 'reaction'"
check_snippet "src/index.ts" "sendReaction wiring" "sendReaction: async \\(jid, emoji, messageId\\)"
check_snippet "src/index.ts" "getMessageFromMe import" "^[[:space:]]*getMessageFromMe,"

# 6. Container MCP tool.
check_snippet "container/agent-runner/src/ipc-mcp-stdio.ts" "react_to_message tool" "'react_to_message'"
check_snippet "container/agent-runner/src/ipc-mcp-stdio.ts" "reaction IPC frame" "type: 'reaction'"

# 7. Net-new files.
if [ -f "$WORKTREE/container/skills/reactions/SKILL.md" ]; then
  ok "container/skills/reactions/SKILL.md present"
else
  fail "container/skills/reactions/SKILL.md missing"
fi
if [ -f "$WORKTREE/scripts/migrate-reactions.ts" ]; then
  ok "scripts/migrate-reactions.ts present"
else
  fail "scripts/migrate-reactions.ts missing"
fi

# 8. No dependency drift — lockfiles must match the base (reactions adds no deps).
for lf in package-lock.json container/agent-runner/package-lock.json; do
  if git -C "$WORKTREE" diff --quiet "$BASE_REF" -- "$lf" 2>/dev/null; then
    ok "$lf unchanged vs $BASE_REF (no dep drift)"
  else
    fail "$lf differs from $BASE_REF — reactions should add no dependencies"
  fi
done

# 9. Real typecheck — host then container (node_modules installed by porter).
if [ -d "$WORKTREE/node_modules" ]; then
  echo "  [..] typechecking host (tsc --noEmit)..."
  if ( cd "$WORKTREE" && npx tsc --noEmit >/dev/null 2>&1 ); then
    ok "host typecheck clean"
  else
    fail "host typecheck failed (run 'cd $WORKTREE && npx tsc --noEmit')"
  fi
else
  fail "host node_modules missing — run 'npm ci' in $WORKTREE before verifying"
fi

if [ -d "$WORKTREE/container/agent-runner/node_modules" ]; then
  echo "  [..] typechecking container agent-runner (tsc --noEmit)..."
  if ( cd "$WORKTREE/container/agent-runner" && npx tsc --noEmit >/dev/null 2>&1 ); then
    ok "container typecheck clean"
  else
    fail "container typecheck failed (run 'cd $WORKTREE/container/agent-runner && npx tsc --noEmit')"
  fi
else
  fail "container node_modules missing — run 'npm ci' in $WORKTREE/container/agent-runner"
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "✓ F6 VERIFIED"
  exit 0
else
  echo "✗ F6 NOT verified — see [FAIL] lines above" >&2
  exit 1
fi
