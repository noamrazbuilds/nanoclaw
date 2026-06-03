#!/usr/bin/env bash
#
# verify-spec-U1-core.sh — Phase 2 verification for U1-core.
#
# Runs the host-side checks for the v2 core transcription helper.
# Per migration-notes/specs/porter-utils/U1-core.md the spec is "locked"
# only when this script exits 0.
#
# Checks (all must pass):
#   1. src/transcription.ts exists and exports transcribeAudioBuffer + FALLBACK_MESSAGE
#   2. scripts/whisper_transcribe.py exists and matches the production source byte-for-byte
#   3. src/transcription.test.ts exists
#   4. pnpm run build (full TypeScript typecheck) exits 0
#   5. pnpm exec vitest run src/transcription.test.ts exits 0
#
# Exit codes:
#   0  all checks pass
#   1  any check failed

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "FATAL: not inside a git working tree" >&2; exit 1
}
cd "$REPO_ROOT"

FAIL=0
note() { printf '  [%s] %s\n' "$1" "$2"; }
ok()   { note OK   "$1"; }
fail() { note FAIL "$1" >&2; FAIL=1; }

echo "Verifying U1-core..."

# 1. transcription.ts presence + exports
if [ ! -f src/transcription.ts ]; then
  fail "src/transcription.ts missing"
else
  if grep -qE '^export (async )?function transcribeAudioBuffer\b' src/transcription.ts \
     && grep -qE '^export const FALLBACK_MESSAGE' src/transcription.ts; then
    ok "src/transcription.ts exports transcribeAudioBuffer + FALLBACK_MESSAGE"
  else
    fail "src/transcription.ts missing required exports"
  fi
fi

# 2. whisper_transcribe.py exists + matches production
PROD_SCRIPT="/home/nanoclaw/NanoClaw/scripts/whisper_transcribe.py"
if [ ! -f scripts/whisper_transcribe.py ]; then
  fail "scripts/whisper_transcribe.py missing"
elif [ ! -f "$PROD_SCRIPT" ]; then
  fail "production source $PROD_SCRIPT not found — cannot validate byte-match"
else
  HERE_SHA=$(sha256sum scripts/whisper_transcribe.py | cut -d' ' -f1)
  PROD_SHA=$(sha256sum "$PROD_SCRIPT" | cut -d' ' -f1)
  if [ "$HERE_SHA" = "$PROD_SHA" ]; then
    ok "scripts/whisper_transcribe.py matches production (sha256: ${HERE_SHA:0:12}...)"
  else
    fail "scripts/whisper_transcribe.py deviates from production (here=${HERE_SHA:0:12}, prod=${PROD_SHA:0:12})"
  fi
fi

# 3. unit test present
if [ -f src/transcription.test.ts ]; then
  ok "src/transcription.test.ts present"
else
  fail "src/transcription.test.ts missing"
fi

# 4. typecheck
echo "  [..] running pnpm run build..."
if pnpm run build >/dev/null 2>&1; then
  ok "pnpm run build (typecheck) exit 0"
else
  fail "pnpm run build failed"
  echo "      Re-run 'pnpm run build' to see errors." >&2
fi

# 5. unit test
echo "  [..] running unit test..."
if pnpm exec vitest run src/transcription.test.ts >/dev/null 2>&1; then
  ok "src/transcription.test.ts passes"
else
  fail "src/transcription.test.ts failed"
  echo "      Re-run 'pnpm exec vitest run src/transcription.test.ts' to see errors." >&2
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "✓ U1-core VERIFIED"
  exit 0
else
  echo "✗ U1-core NOT verified — see [FAIL] lines above" >&2
  exit 1
fi
