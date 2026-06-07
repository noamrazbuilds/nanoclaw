#!/usr/bin/env bash
# F4 — Ensure the OneCLI proxy CA cert is on the host filesystem.
#
# Host-side scripts that make HTTPS calls through the OneCLI proxy need its CA
# cert (`curl --cacert <ca.pem>`). v2 mounts/bakes the cert for AGENT containers
# natively, but host-side scripts (cron backups, etc.) run outside any container,
# so the cert must be on the host. On a fresh install or after a data/ rebuild
# it's missing; this extracts it from the running OneCLI container.
#
# Source-able: `source scripts/lib/ensure-onecli-ca.sh` then use "$ONECLI_CA".
# Fails soft — if OneCLI isn't running, the later `curl --cacert` surfaces a
# clear error rather than this preamble killing the caller.
ONECLI_CA="${ONECLI_CA:-${PROJECT_ROOT:-$(pwd)}/data/onecli-proxy-ca.pem}"
if [ ! -f "$ONECLI_CA" ]; then
  mkdir -p "$(dirname "$ONECLI_CA")"
  docker compose -f "$HOME/.onecli/docker-compose.yml" exec -T app \
    cat /app/data/gateway/ca.pem > "$ONECLI_CA" 2>/dev/null || true
fi
export ONECLI_CA
