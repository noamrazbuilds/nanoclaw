#!/usr/bin/env bash
#
# verify-spec-U2.sh — Phase 2 verification for U2 (image + sticker).

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "FATAL: not inside a git working tree" >&2; exit 1
}
cd "$REPO_ROOT"

WORKTREE="/home/nanoclaw/nanoclaw-v2-porter-U2"
EXPECTED_BRANCH="porter-U2"

FAIL=0
note() { printf '  [%s] %s\n' "$1" "$2"; }
ok()   { note OK   "$1"; }
fail() { note FAIL "$1" >&2; FAIL=1; }

echo "Verifying U2..."

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

# 2. image.ts byte-match vs v1 source
V1_IMAGE="docs/v1-fork-reference/src/image.ts"
if [ -f "$WORKTREE/src/image.ts" ] && [ -f "$V1_IMAGE" ]; then
  HERE_SHA=$(sha256sum "$WORKTREE/src/image.ts" | cut -d' ' -f1)
  V1_SHA=$(sha256sum "$V1_IMAGE" | cut -d' ' -f1)
  if [ "$HERE_SHA" = "$V1_SHA" ]; then
    ok "src/image.ts matches v1 verbatim (sha256: ${HERE_SHA:0:12}...)"
  else
    fail "src/image.ts differs from v1 source"
  fi
else
  fail "src/image.ts missing in worktree or v1 reference"
fi

# 3. whatsapp.ts contains expected snippets
WA_TS="$WORKTREE/src/channels/whatsapp.ts"
if [ ! -f "$WA_TS" ]; then
  fail "src/channels/whatsapp.ts missing"
else
  check_snippet() {
    local label="$1"; local pattern="$2"
    if grep -qE "$pattern" "$WA_TS"; then
      ok "whatsapp.ts contains: $label"
    else
      fail "whatsapp.ts missing: $label"
    fi
  }
  check_snippet "downloadMediaMessage import"  "^[[:space:]]*downloadMediaMessage,"
  check_snippet "GROUPS_DIR import"            "^[[:space:]]*GROUPS_DIR,"
  check_snippet "image module import"          "from '\\.\\./image"
  check_snippet "isImageMessage usage"         "isImageMessage\\(msg\\)"
  check_snippet "isStickerMessage usage"       "isStickerMessage\\(msg\\)"
  check_snippet "processImage call"            "processImage\\("
  check_snippet "processSticker call"          "processSticker\\("
  check_snippet "Sticker fallback content"     "content = '\\[Sticker\\]'"
fi

# 4. sharp dep
if [ -f "$WORKTREE/package.json" ]; then
  if grep -q '"sharp"' "$WORKTREE/package.json"; then
    ok "package.json has sharp dep"
  else
    fail "package.json missing sharp dep"
  fi
fi

# 5. frozen lockfile
echo "  [..] running pnpm install --frozen-lockfile in worktree..."
if ( cd "$WORKTREE" && pnpm install --frozen-lockfile >/dev/null 2>&1 ); then
  ok "pnpm install --frozen-lockfile clean"
else
  fail "pnpm install --frozen-lockfile failed"
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "✓ U2 VERIFIED"
  exit 0
else
  echo "✗ U2 NOT verified — see [FAIL] lines above" >&2
  exit 1
fi
