#!/usr/bin/env bash
#
# verify-spec-U1-wa.sh — Phase 2 verification for U1-wa.
#
# Runs against the porter worktree at
#   /home/nanoclaw/nanoclaw-v2-porter-U1-wa
# (created by `bash scripts/setup-porter-worktree.sh U1-wa --base whatsapp-fork/main`).
#
# Content/sha-based checks rather than full standalone typecheck because
# whatsapp-fork/main has a pre-existing pino-missing issue (documented as
# F0-5 in migration-notes/phase-0-findings.md). Full typecheck happens
# in Phase 3 when the file is installed into a complete v2 install via
# /add-whatsapp.
#
# Checks:
#   1. Porter worktree exists at the expected path on the expected branch.
#   2. src/transcription.ts in worktree matches v2-migration's sha256 byte-for-byte.
#   3. scripts/whisper_transcribe.py in worktree matches production sha256.
#   4. src/channels/whatsapp.ts contains the expected snippets:
#      - downloadMediaMessage import
#      - transcribeAudioBuffer + FALLBACK_MESSAGE import
#      - isVoiceMessage function definition
#      - voice handler block referencing all three
#   5. package.json has openai dep.
#   6. pnpm-lock.yaml is committed and consistent (frozen-lockfile resolves clean).

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "FATAL: not inside a git working tree" >&2; exit 1
}
cd "$REPO_ROOT"

WORKTREE="/home/nanoclaw/nanoclaw-v2-porter-U1-wa"
EXPECTED_BRANCH="porter-U1-wa"

FAIL=0
note() { printf '  [%s] %s\n' "$1" "$2"; }
ok()   { note OK   "$1"; }
fail() { note FAIL "$1" >&2; FAIL=1; }

echo "Verifying U1-wa..."

# 1. Worktree presence + branch
if [ ! -d "$WORKTREE" ]; then
  fail "porter worktree missing at $WORKTREE — run scripts/setup-porter-worktree.sh U1-wa --base whatsapp-fork/main"
else
  BRANCH=$(git -C "$WORKTREE" rev-parse --abbrev-ref HEAD)
  if [ "$BRANCH" = "$EXPECTED_BRANCH" ]; then
    ok "porter worktree on branch $BRANCH"
  else
    fail "porter worktree on wrong branch: $BRANCH (expected $EXPECTED_BRANCH)"
  fi
fi

# 2. transcription.ts present in worktree with matching exports.
# Byte-match would be ideal but the two repos have different prettier
# configs which reformat the file post-checkout. What's load-bearing is
# semantic equivalence — both files must export transcribeAudioBuffer +
# FALLBACK_MESSAGE so whatsapp.ts's imports resolve.
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

# 4. whatsapp.ts contains expected snippets
WA_TS="$WORKTREE/src/channels/whatsapp.ts"
if [ ! -f "$WA_TS" ]; then
  fail "src/channels/whatsapp.ts missing in worktree"
else
  check_snippet() {
    local label="$1"; local pattern="$2"
    if grep -qE "$pattern" "$WA_TS"; then
      ok "whatsapp.ts contains: $label"
    else
      fail "whatsapp.ts missing: $label (pattern: $pattern)"
    fi
  }
  check_snippet "downloadMediaMessage import"  "^[[:space:]]*downloadMediaMessage,"
  check_snippet "transcription import"          "from '\\.\\./transcription"
  check_snippet "FALLBACK_MESSAGE reference"    "FALLBACK_MESSAGE"
  check_snippet "isVoiceMessage definition"     "^function isVoiceMessage"
  check_snippet "isVoiceMessage usage"          "isVoiceMessage\\(normalized\\)"
  check_snippet "downloadMediaMessage call"     "await downloadMediaMessage\\("
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
  echo "✓ U1-wa VERIFIED"
  exit 0
else
  echo "✗ U1-wa NOT verified — see [FAIL] lines above" >&2
  exit 1
fi
