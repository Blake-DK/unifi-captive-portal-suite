#!/usr/bin/env bash
# Drive the guest-registration load from THIS machine at a portal running
# somewhere else. Needs only docker and the registration-burst.js next to
# this script (copy the test/load/ folder to any box, no repo required).
#
#   TARGET=https://wifi.example.com ./remote-run.sh                  # 3000 guests / 10 min
#   TARGET=https://wifi.example.com GUESTS=50 WINDOW=2m ./remote-run.sh   # start small
#   TARGET=https://wifi.example.com MODE=burst VUS=100 ./remote-run.sh    # stampede shape
#
# Extra env: INSECURE=1 (skip TLS verify), SITE=<slug> (captive-page site,
# default "default"), P95_MS=<ms> (authorize p95 threshold, default 2000),
# YES=1 (skip the confirmation prompt), DOCKER_NET=<network> (attach the k6
# container to a docker network, for lab setups), SHARD=<n> (identity band
# for this box; give each generator in a multi-box run a different number).
#
# THIS IS NOT A DRILL AGAINST A REAL TARGET: every iteration creates a real
# guest registration (names Load Guest<N>, phones 55xxxxxxxx) and a real
# authorize call for a fake aa:bb:xx MAC on the target's controller. Before
# a big run: turn OFF email verification and sponsor-required on the target
# (or registrations fail / flood mailboxes), and start with GUESTS=50.
# Fake-MAC authorizations expire with the plan duration; the guest rows age
# out via retention or can be revoked on the admin guests page.
set -euo pipefail
cd "$(dirname "$0")"

: "${TARGET:?set TARGET to the portal base URL, e.g. https://wifi.example.com}"
MODE="${MODE:-event}"
K6_IMAGE="${K6_IMAGE:-grafana/k6:0.57.0}"

if [ "${YES:-}" != "1" ]; then
  echo "About to load-test ${TARGET} (MODE=${MODE}, GUESTS=${GUESTS:-3000}, WINDOW=${WINDOW:-10m})."
  echo "This creates REAL registrations there and REAL authorize calls on its controller."
  printf 'Continue? [y/N] '
  read -r answer
  [ "$answer" = "y" ] || [ "$answer" = "Y" ] || { echo "aborted"; exit 1; }
fi

netargs=()
[ -n "${DOCKER_NET:-}" ] && netargs=(--network "$DOCKER_NET")

exec docker run --rm -i "${netargs[@]}" \
  -e TARGET="$TARGET" -e MODE="$MODE" \
  -e GUESTS="${GUESTS:-3000}" -e WINDOW="${WINDOW:-10m}" \
  -e VUS="${VUS:-150}" -e RAMP="${RAMP:-30s}" -e HOLD="${HOLD:-60s}" -e THINK="${THINK:-0}" \
  -e INSECURE="${INSECURE:-}" -e SITE="${SITE:-default}" -e P95_MS="${P95_MS:-2000}" \
  -e SHARD="${SHARD:-0}" \
  "$K6_IMAGE" run - <registration-burst.js
