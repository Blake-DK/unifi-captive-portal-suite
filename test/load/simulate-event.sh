#!/usr/bin/env bash
# One command to simulate a real event: GUESTS people arriving over WINDOW,
# each loading the captive page, filling the form for a few seconds, then
# registering. Runs entirely against a throwaway local stack (Postgres +
# portal image + mock controller); it never touches production, the real
# controller, or real guest data.
#
#   ./test/load/simulate-event.sh                 # 3000 guests over 10 min
#   GUESTS=5000 WINDOW=15m ./test/load/simulate-event.sh
#   E2E_IMAGE=portal-under-test ./test/load/simulate-event.sh   # local build
#
# Default image is the :nightly registry tag, i.e. exactly what the nightly
# line shipped. The run fails if >1% of registrations fail or authorize p95
# exceeds 2s.
set -euo pipefail
cd "$(dirname "$0")"

GUESTS="${GUESTS:-3000}"
WINDOW="${WINDOW:-10m}"
E2E_IMAGE="${E2E_IMAGE:-ghcr.io/blake-dk/unifi-captiveportal:nightly}"
export GUESTS WINDOW E2E_IMAGE MODE=event

# Refresh the registry tag when we can; a stale local tag would silently
# test old code. A local-only image name just skips the pull.
if ! docker pull "$E2E_IMAGE" 2>/dev/null; then
  docker image inspect "$E2E_IMAGE" >/dev/null 2>&1 || {
    echo "!! image $E2E_IMAGE is neither pullable nor present locally" >&2
    exit 1
  }
  echo "==> could not pull $E2E_IMAGE; using the local copy"
fi

echo "==> Simulating ${GUESTS} guests arriving over ${WINDOW} (image: ${E2E_IMAGE})"
exec ./run.sh
