#!/usr/bin/env bash
# Registration-burst load test. Reuses the e2e topology (docker-compose.test.yml:
# throwaway Postgres + the portal image under test + the mock UniFi controller)
# and drives it with containerized k6 on the same bridge network: nothing to
# install on the host, no published ports.
#
#   E2E_IMAGE=<portal image> ./test/load/run.sh
#   VUS=300 HOLD=120s ./test/load/run.sh        # heavier burst
#
# What this measures: the PORTAL's burst behavior (DB pool queueing, audit
# serialization, session single-flight). The mock controller answers
# instantly, so real-controller latency is NOT covered. Treat a pass here
# as "the app won't fall over", not "the whole system will".
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT="portal-load"
NET="${PROJECT}_default"
K6_IMAGE="${K6_IMAGE:-grafana/k6:0.57.0}"
: "${E2E_IMAGE:?set E2E_IMAGE to the portal image under test}"
export E2E_IMAGE

docker compose version >/dev/null 2>&1 || {
  echo "docker compose v2 plugin is required" >&2
  exit 1
}

compose() { docker compose -p "$PROJECT" -f "$ROOT/docker-compose.test.yml" "$@"; }

rc=1
cleanup() {
  if [ "$rc" -ne 0 ]; then
    echo "==> FAILURE: dumping service logs"
    compose logs --no-color --tail=200 portal mock-unifi db || true
  fi
  compose down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Compose up (image under test: $E2E_IMAGE)"
compose up -d --build --wait --wait-timeout 180

MODE="${MODE:-burst}"
if [ "$MODE" = "event" ]; then
  echo "==> Run k6 (MODE=event GUESTS=${GUESTS:-3000} WINDOW=${WINDOW:-10m})"
else
  echo "==> Run k6 (MODE=burst VUS=${VUS:-150} HOLD=${HOLD:-60s} THINK=${THINK:-0})"
fi
if docker run --rm -i --network "$NET" \
  -e BASE_URL="http://portal:3000" \
  -e MODE="$MODE" -e GUESTS="${GUESTS:-3000}" -e WINDOW="${WINDOW:-10m}" \
  -e VUS="${VUS:-150}" -e RAMP="${RAMP:-30s}" -e HOLD="${HOLD:-60s}" -e THINK="${THINK:-0}" \
  "$K6_IMAGE" run - <"$ROOT/test/load/registration-burst.js"; then
  rc=0
else
  rc=$?
fi
exit "$rc"
