#!/usr/bin/env bash
#
# verify-spec-U1-tg.sh — Phase 2 verification for U1-tg.
#
# Same shape as verify-spec-U1-wa.sh: content/sha-based checks against
# the porter worktree at /home/nanoclaw/nanoclaw-v2-porter-U1-tg
# (created by `bash scripts/setup-porter-worktree.sh U1-tg --base
# telegram-fork/main`).
#
# Standalone typecheck of telegram-fork doesn't pass because of F0-6
# (pre-existing import mismatch in synced telegram-pairing.ts —
# `../log.js` v2-style vs fork's `../logger.js` v1-style). Full
# typecheck happens implicitly at Phase 3 in a complete v2 install.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "FATAL: not inside a git working tree" >&2; exit 1
}
cd "$REPO_ROOT"

WORKTREE="/home/nanoclaw/nanoclaw-v2-porter-U1-tg"
EXPECTED_BRANCH="porter-U1-tg"

FAIL=0
note() { printf '  [%s] %s\n' "$1" "$2"; }
ok()   { note OK   "$1"; }
fail() { note FAIL "$1" >&2; FAIL=1; }

echo "Verifying U1-tg..."

# 1. Worktree presence + branch
if [ ! -d "$WORKTREE" ]; then
  fail "porter worktree missing at $WORKTREE — run scripts/setup-porter-worktree.sh U1-tg --base telegram-fork/main"
else
  BRANCH=$(git -C "$WORKTREE" rev-parse --abbrev-ref HEAD)
  if [ "$BRANCH" = "$EXPECTED_BRANCH" ]; then
    ok "porter worktree on branch $BRANCH"
  else
    fail "porter worktree on wrong branch: $BRANCH (expected $EXPECTED_BRANCH)"
  fi
fi

# 2. transcription.ts present with required exports
if [ -d "$WORKTREE" ] && [ -f "$WORKTREE/src/transcription.ts" ]; then
  if grep -qE '^export (async )?function transcribeAudioBuffer\b' "$WORKTREE/src/transcription.ts" \
     && grep -qE '^export const FALLBACK_MESSAGE' "$WORKTREE/src/transcription.ts"; then
    ok "src/transcription.ts exports transcribeAudioBuffer + FALLBACK_MESSAGE"
  else
    fail "src/transcription.ts missing required exports"
  fi
else
  fail "src/transcription.ts missing in porter worktree"
fi

# 3. whisper_transcribe.py byte-match vs production
PROD_SCRIPT="/home/nanoclaw/NanoClaw/scripts/whisper_transcribe.py"
if [ -f "$WORKTREE/scripts/whisper_transcribe.py" ] && [ -f "$PROD_SCRIPT" ]; then
  HERE_SHA=$(sha256sum "$WORKTREE/scripts/whisper_transcribe.py" | cut -d' ' -f1)
  PROD_SHA=$(sha256sum "$PROD_SCRIPT" | cut -d' ' -f1)
  if [ "$HERE_SHA" = "$PROD_SHA" ]; then
    ok "scripts/whisper_transcribe.py matches production"
  else
    fail "scripts/whisper_transcribe.py deviates from production"
  fi
else
  fail "scripts/whisper_transcribe.py missing in worktree or production"
fi

# 4. telegram.ts contains expected snippets
TG_TS="$WORKTREE/src/channels/telegram.ts"
if [ ! -f "$TG_TS" ]; then
  fail "src/channels/telegram.ts missing in worktree"
else
  check_snippet() {
    local label="$1"; local pattern="$2"
    if grep -qE "$pattern" "$TG_TS"; then
      ok "telegram.ts contains: $label"
    else
      fail "telegram.ts missing: $label (pattern: $pattern)"
    fi
  }
  check_snippet "transcription import"          "from '\\.\\./transcription"
  check_snippet "FALLBACK_MESSAGE reference"    "FALLBACK_MESSAGE"
  check_snippet "transcribeAudioBuffer call"    "transcribeAudioBuffer\\("
  check_snippet "async voice handler"           "bot\\.on\\('message:voice', async"
  check_snippet "Bot API getFile call"          "ctx\\.api\\.getFile\\("
  # multi-line https chain (`https\n  .get(fileUrl, ...)`) — check the
  # call site as two simple substrings rather than a multi-line regex.
  if grep -q "\\.get(fileUrl" "$TG_TS" && grep -q "^import https" "$TG_TS"; then
    ok "telegram.ts contains: https.get(fileUrl) download call"
  else
    fail "telegram.ts missing: https.get(fileUrl) download call"
  fi
fi

# 5. openai dep
if [ -f "$WORKTREE/package.json" ]; then
  if grep -q '"openai"' "$WORKTREE/package.json"; then
    ok "package.json has openai dep"
  else
    fail "package.json missing openai dep"
  fi
fi

# 6. frozen lockfile resolves clean
echo "  [..] running pnpm install --frozen-lockfile in worktree..."
if ( cd "$WORKTREE" && pnpm install --frozen-lockfile >/dev/null 2>&1 ); then
  ok "pnpm install --frozen-lockfile clean"
else
  fail "pnpm install --frozen-lockfile failed (lockfile out of sync)"
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "✓ U1-tg VERIFIED"
  exit 0
else
  echo "✗ U1-tg NOT verified — see [FAIL] lines above" >&2
  exit 1
fi
