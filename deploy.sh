#!/usr/bin/env bash
# Deploy the latest portal image and reclaim disk.
#
# CI (.github/workflows/release-and-publish.yml) pushes both :latest and a
# per-commit :<sha> tag on every merge to main. Pulling here keeps the old
# per-commit images around (~1.4 GB each) and the Docker build cache grows
# unbounded — left alone this fills the host disk, and a full disk fails the
# on-boot Prisma migration and crash-loops the container. So every deploy ends
# by pruning: dangling images, superseded per-commit tags (keeping the newest
# few as rollbacks), and build cache older than a few days.
#
# Usage:  ./deploy.sh
set -euo pipefail

cd "$(dirname "$0")"

REPO="ghcr.io/blake-dk/unifi-captiveportal"
SERVICE="portal"
CONTAINER="unifi-captive-portal"
KEEP_IMAGES=3           # newest per-commit tags to retain as rollbacks
CACHE_KEEP="72h"        # drop build cache older than this

echo "==> Disk before:"
df -h / | awk 'NR==1 || /\//{print}'

echo "==> Pulling latest image..."
# See setup.sh for why this needs a login-and-retry fallback: GHCR
# requires authentication for every pull of private-repo packages, so a host
# with no cached registry credentials gets "unauthorized".
# If GHCR_PULL_TOKEN is set in .env, log in non-interactively up front instead.
# shellcheck disable=SC1091
[ -f .env ] && set -a && . ./.env && set +a
if [ -n "${GHCR_PULL_TOKEN:-}" ]; then
  echo "    Logging in to the registry with the configured pull token..."
  echo "$GHCR_PULL_TOKEN" | docker login ghcr.io -u "${GHCR_PULL_USER:-blakey108}" --password-stdin
fi

# Optional guest/admin split (COMPOSE_PROFILES includes "split"): the admin
# container runs the same image — restart and health-check it in the same
# deploy. `compose config --services` only lists profile-enabled services.
# Capture it as a plain assignment (no `2>/dev/null` inside an `if`) so a real
# compose/daemon failure aborts here rather than silently degrading a split
# deploy to guest-only (which would leave the admin container on the old image
# against a schema the guest just migrated on boot).
if ! all_services="$(docker compose config --services)"; then
  echo "!! 'docker compose config' failed — cannot determine services to deploy." >&2
  echo "   Fix the compose/.env error and re-run; NOT deploying a partial set." >&2
  exit 1
fi
SERVICES=("$SERVICE")
CONTAINERS=("$CONTAINER")
if grep -qx "portal-admin" <<<"$all_services"; then
  SERVICES+=(portal-admin)
  CONTAINERS+=(unifi-captive-portal-admin)
fi

# One pull covers both services (identical image ref); `up -d` starts each.
pull_log="$(mktemp)"
if ! docker compose pull "$SERVICE" 2>&1 | tee "$pull_log"; then
  if grep -qi unauthorized "$pull_log"; then
    rm -f "$pull_log"
    echo "    Registry needs authentication — log in with your GitHub username + PAT (read:packages):"
    docker login ghcr.io
    docker compose pull "$SERVICE"
  else
    rm -f "$pull_log"
    exit 1
  fi
else
  rm -f "$pull_log"
fi

echo "==> Restarting container(s) (migrations run on boot)..."
docker compose up -d "${SERVICES[@]}"

# The traefik-ops sidecar reads its bind-mounted watch script once at start,
# and `up -d` never recreates it for a script content change — bounce it so
# repo updates to scripts/traefik-ops-watch.sh take effect. It holds no
# traffic, so the restart is free; skip silently when the profile is off.
if grep -qx "traefik-ops" <<<"$all_services"; then
  docker compose restart traefik-ops >/dev/null 2>&1 || true
fi

echo "==> Waiting for health..."
for c in "${CONTAINERS[@]}"; do
  ip="$(docker inspect "$c" --format '{{range .NetworkSettings.Networks}}{{if .IPAddress}}{{.IPAddress}} {{end}}{{end}}' | awk '{print $1}')"
  health=""
  for _ in $(seq 1 20); do
    sleep 3
    health="$(curl -fsS "http://${ip}:3000/api/health" 2>/dev/null || true)"
    [ -n "$health" ] && break
  done
  if [ -z "$health" ]; then
    echo "!! Health check never responded for $c — NOT pruning (leaving images intact for rollback)."
    echo "   Check: docker logs $c"
    exit 1
  fi
  echo "    $c: $health"
done

echo "==> Verifying DB migrations..."
# The entrypoint runs `prisma migrate deploy` on boot; a hard failure
# crash-loops the container and the health check above catches it. This closes
# the remaining gap — a healthy app on a NOT-fully-migrated schema (pending or
# failed-but-recorded migrations) — by asking Prisma directly. Warn-only:
# health stays the hard gate, and pruning below is still safe either way.
if migrate_out="$(docker compose exec -T "$SERVICE" node_modules/.bin/prisma migrate status 2>&1)"; then
  echo "    Database schema is up to date."
else
  echo "$migrate_out" | sed 's/^/    /'
  echo "!! The DB schema is NOT fully migrated — the app is up but may misbehave."
  echo "   The entrypoint applies migrations on boot; check: docker logs $CONTAINER"
fi
# 1. Dangling (untagged) images — always safe.
docker image prune -f >/dev/null

# 2. Superseded per-commit portal tags: keep the newest $KEEP_IMAGES, and
#    never touch the tag any running container is on or :latest. In a split
#    both portal containers may be on different image IDs — collect them all.
running_imgs=""
for c in "${CONTAINERS[@]}"; do
  running_imgs+=" $(docker inspect "$c" --format '{{.Image}}' 2>/dev/null || true)"
done
mapfile -t sha_tags < <(docker images "$REPO" --format '{{.Tag}} {{.ID}} {{.CreatedAt}}' \
  | grep -v '^latest ' | sort -k3 -r)
i=0
for entry in "${sha_tags[@]}"; do
  tag="${entry%% *}"; rest="${entry#* }"; id="${rest%% *}"
  i=$((i + 1))
  if [ "$i" -le "$KEEP_IMAGES" ]; then continue; fi
  # Skip if this image backs any running portal container.
  case "$running_imgs" in *"$id"*) continue;; esac
  docker rmi "$REPO:$tag" >/dev/null 2>&1 && echo "    removed $REPO:$tag" || true
done

# 3. Build cache older than the keep window (fast recent rebuilds still cached).
docker builder prune -f --filter "until=$CACHE_KEEP" >/dev/null 2>&1 || docker builder prune -f >/dev/null 2>&1 || true

echo "==> Disk after:"
df -h / | awk 'NR==1 || /\//{print}'
echo "==> Done."
