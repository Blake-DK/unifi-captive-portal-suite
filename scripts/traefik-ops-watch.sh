#!/bin/sh
# traefik-ops sidecar: the ONLY container holding the docker socket. The
# portal never gets it — instead it drops files into the shared ./traefik
# mount and this loop acts on them:
#   restart-requested   written by POST /api/admin/traefik/restart
#                       (admin + password/TOTP re-auth) — manual restart
#   traefik.yml change  written on Reverse-Proxy settings save — static
#                       config (ACME email / Cloudflare token) auto-applies
# Either way the traefik container is restarted so the new static config
# loads; dynamic config needs nothing (Traefik polls the portal for it).
#
# It also PUBLISHES the other direction: every ~10s it writes
# docker-status.json (state/health of the stack's containers) into the same
# mount, which feeds the System Health panel on Settings -> URLs. That file
# is informational only — the portal never acts on it.
set -u

DIR=/watch
TARGET="${TRAEFIK_CONTAINER:-unifi-captive-portal-traefik}"
# Substring match for `docker ps --filter name=`; the compose file pins all
# container_names to this prefix.
STATUS_FILTER="${STATUS_CONTAINER_FILTER:-unifi-captive-portal}"
# Access log written by Traefik for the log dashboard (logdash profile).
# Traefik never rotates its own logs, so this loop truncates the file in
# place past the cap — the inode survives, so both Traefik's open handle and
# the dashboard agent's tail keep working (the agent re-seeks on shrink).
LOG_FILE="${ACCESS_LOG_FILE:-/traefik-logs/access.log}"
LOG_MAX_MB="${LOG_MAX_MB:-256}"

hash_cfg() { md5sum "$DIR/traefik.yml" 2>/dev/null | cut -d' ' -f1; }

rotate_log() {
  [ -f "$LOG_FILE" ] || return 0
  size="$(stat -c %s "$LOG_FILE" 2>/dev/null || echo 0)"
  if [ "$size" -gt $((LOG_MAX_MB * 1024 * 1024)) ]; then
    echo "traefik-ops: access.log ${size}B exceeds ${LOG_MAX_MB}MB - truncating"
    : > "$LOG_FILE"
  fi
}

# Atomic (tmp + mv) so the portal never reads a half-written file. `-a` keeps
# exited/crash-looping containers visible instead of silently vanishing.
write_status() {
  {
    printf '{"generatedAt":"%s","containers":[' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    docker ps -a --filter "name=$STATUS_FILTER" \
      --format '{"name":{{json .Names}},"state":{{json .State}},"status":{{json .Status}},"image":{{json .Image}}}' \
      2>/dev/null | awk 'NR>1{printf ","}{printf "%s",$0}'
    printf ']}'
  } > "$DIR/docker-status.json.tmp" && mv -f "$DIR/docker-status.json.tmp" "$DIR/docker-status.json"
}

last="$(hash_cfg)"
echo "traefik-ops: watching $DIR (target: $TARGET)"
write_status
n=0
while :; do
  sleep 2
  n=$((n + 1))
  [ $((n % 5)) -eq 0 ] && write_status
  [ $((n % 30)) -eq 0 ] && rotate_log
  if [ -f "$DIR/restart-requested" ]; then
    rm -f "$DIR/restart-requested"
    echo "traefik-ops: restart requested via portal"
    docker restart "$TARGET" >/dev/null 2>&1 || echo "traefik-ops: restart failed"
    last="$(hash_cfg)"
    continue
  fi
  cur="$(hash_cfg)"
  if [ -n "$cur" ] && [ "$cur" != "$last" ]; then
    last="$cur"
    echo "traefik-ops: static config changed — restarting"
    docker restart "$TARGET" >/dev/null 2>&1 || echo "traefik-ops: restart failed"
  fi
done
