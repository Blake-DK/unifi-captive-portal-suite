#!/usr/bin/env bash
# The e2e suite's single entrypoint, shared by CI and local runs.
# Needs: docker with the compose v2 plugin, and E2E_IMAGE pointing at the
# portal image under test. Everything runs in containers — no node on the
# host required, no bind mounts (they don't survive docker-out-of-docker,
# where paths inside a CI job container are not host paths).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT="portal-e2e"
NET="${PROJECT}_default"
RUNNER_IMG="portal-e2e-runner"
RUNNER_CTR="portal-e2e-run"
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
    compose logs --no-color --tail=300 portal mock-unifi db || true
    mkdir -p "$ROOT/e2e-artifacts"
    docker cp "$RUNNER_CTR:/e2e/test-results" "$ROOT/e2e-artifacts/" 2>/dev/null || true
    docker cp "$RUNNER_CTR:/e2e/playwright-report" "$ROOT/e2e-artifacts/" 2>/dev/null || true
  fi
  docker rm -f "$RUNNER_CTR" >/dev/null 2>&1 || true
  compose down -v --remove-orphans || true
}
trap cleanup EXIT

echo "==> Compose up (image under test: $E2E_IMAGE)"
compose up -d --build --wait --wait-timeout 180

echo "==> Build Playwright runner"
docker build -t "$RUNNER_IMG" "$ROOT/test/e2e"

echo "==> Run specs"
docker rm -f "$RUNNER_CTR" >/dev/null 2>&1 || true
if docker run --name "$RUNNER_CTR" --network "$NET" \
  -e E2E_BASE_URL=http://portal:3000 "$RUNNER_IMG"; then
  rc=0
else
  rc=$?
fi
exit "$rc"
