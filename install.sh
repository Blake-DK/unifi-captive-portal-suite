#!/usr/bin/env bash
# install.sh — the single command for a UniFi Captive Portal host.
#
# Bootstrap a fresh host with the one-liner (keeps prompts interactive):
#   bash <(curl -fsSL https://raw.githubusercontent.com/Blake-DK/unifi-captive-portal-suite/main/install.sh)
#
# Then everything else is a subcommand of the same script:
#   ./install.sh setup             (re)run first-time setup
#   ./install.sh verify            read-only health + migration check
#   ./install.sh migrate           apply pending DB migrations, then verify
#   ./install.sh update            pull the newest image, restart, health-check, prune
#   ./install.sh channel <line>    follow main | develop | nightly (sets IMAGE_TAG + update)
#   ./install.sh backup            dump the database
#   ./install.sh restore [file]    restore the database from a dump (destructive)
#   ./install.sh help
set -uo pipefail

REPO="ghcr.io/blake-dk/unifi-captive-portal-suite"
SERVICE="portal"
CONTAINER_PORTAL="unifi-captive-portal"
CONTAINER_DB="unifi-captive-portal-db"
COMPOSE_FILE="docker-compose.yml"
REPO_SLUG="Blake-DK/unifi-captive-portal-suite"
KEEP_IMAGES=3
CACHE_KEEP="72h"
CHANNEL="${CHANNEL:-}"   # set by the bootstrap when following develop/nightly

if [ -t 1 ]; then
  GREEN=$'\e[32m'; RED=$'\e[31m'; YEL=$'\e[33m'; DIM=$'\e[2m'; RST=$'\e[0m'
else
  GREEN=""; RED=""; YEL=""; DIM=""; RST=""
fi
ok()   { printf "  ${GREEN}\xe2\x9c\x93${RST} %s\n" "$1"; }
bad()  { printf "  ${RED}\xe2\x9c\x97${RST} %s\n" "$1"; }
warn() { printf "  ${YEL}!${RST} %s\n" "$1"; }
info() { printf "  ${DIM}%s${RST}\n" "$1"; }

need_docker() {
  command -v docker >/dev/null 2>&1 || { echo "!! docker is not installed"; exit 1; }
  docker compose version >/dev/null 2>&1 || { echo "!! the docker compose plugin is not installed"; exit 1; }
}

goto_deploy_dir() {
  local d
  d="$(cd "$(dirname "$0")" 2>/dev/null && pwd)" || d=""
  # Hop to the script's own directory only when it holds the compose file. When
  # we were piped in via `bash <(curl ...)`, $0 is /dev/fd/N (no compose there),
  # so stay in the caller's current directory instead of chasing /dev/fd.
  if [ -n "$d" ] && [ -f "$d/$COMPOSE_FILE" ]; then cd "$d"; fi
  [ -f "$COMPOSE_FILE" ] || { echo "!! run this from the deployment directory (no $COMPOSE_FILE here)"; exit 1; }
}

load_env() { if [ -f .env ]; then set -a; . ./.env; set +a; fi; }

# GHCR login when a pull token is configured (public image needs none; this is
# for a private fork or a locked-down package).
registry_login() {
  load_env
  if [ -n "${GHCR_PULL_TOKEN:-}" ]; then
    echo "    Logging in to the registry with the configured pull token..."
    printf '%s' "$GHCR_PULL_TOKEN" | docker login ghcr.io -u "${GHCR_PULL_USER:-blakey108}" --password-stdin
  fi
}

# docker compose pull with a one-time interactive login fallback on "unauthorized".
pull_with_retry() {
  local log; log="$(mktemp)"
  if ! docker compose pull "$@" 2>&1 | tee "$log"; then
    if grep -qi unauthorized "$log"; then
      rm -f "$log"
      echo "    Registry needs authentication — log in (GitHub username + PAT with read:packages):"
      docker login ghcr.io
      docker compose pull "$@"
    else
      rm -f "$log"; return 1
    fi
  else
    rm -f "$log"
  fi
}

# ---------------------------------------------------------------------------
# verify — read-only: stack up, healthy, DB reachable, migrations applied, /health
# ---------------------------------------------------------------------------
do_verify() {
  goto_deploy_dir
  local FAILED=0 st mig health ver commit
  echo "==> Verifying the deployment (read-only)"
  need_docker
  ok "docker + compose plugin present"
  [ -f .env ] && ok ".env present" || { bad ".env missing — run ./install.sh setup first"; FAILED=$((FAILED+1)); }

  check_health() {
    local c="$1" s
    s="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$c" 2>/dev/null || echo missing)"
    case "$s" in
      healthy|running) ok "container $c: $s" ;;
      starting) warn "container $c: still starting — give it a moment and re-run" ;;
      missing) bad "container $c: not found (is the stack up? './install.sh update' or 'docker compose up -d')"; FAILED=$((FAILED+1)) ;;
      *) bad "container $c: $s"; FAILED=$((FAILED+1)) ;;
    esac
  }
  check_health "$CONTAINER_DB"
  check_health "$CONTAINER_PORTAL"
  if docker compose config --services 2>/dev/null | grep -qx portal-admin; then
    check_health "unifi-captive-portal-admin"
  fi

  if docker exec "$CONTAINER_DB" pg_isready -U portal >/dev/null 2>&1; then
    ok "database is accepting connections"
  else
    bad "database not ready (pg_isready failed)"; FAILED=$((FAILED+1))
  fi

  if mig="$(docker compose exec -T "$SERVICE" node_modules/.bin/prisma migrate status 2>&1)"; then
    ok "database schema is up to date (all migrations applied)"
  else
    bad "schema is NOT fully migrated — migrations pending, failed, or drifted"; FAILED=$((FAILED+1))
    printf "${DIM}%s${RST}\n" "$(printf '%s\n' "$mig" | sed 's/^/      /' | head -12)"
    warn "the entrypoint applies migrations on boot; check: docker logs $CONTAINER_PORTAL"
  fi

  if health="$(docker compose exec -T "$SERVICE" wget -qO- http://127.0.0.1:3000/api/health 2>/dev/null)"; then
    if printf '%s' "$health" | grep -q '"ok":true'; then
      ver="$(printf '%s' "$health" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
      commit="$(printf '%s' "$health" | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p')"
      ok "app is healthy (/api/health — version ${ver:-?}, build ${commit:-?})"
    else
      bad "/api/health did not report ok: $health"; FAILED=$((FAILED+1))
    fi
  else
    bad "could not reach /api/health inside the portal container"; FAILED=$((FAILED+1))
  fi

  echo
  if [ "$FAILED" -eq 0 ]; then
    printf "${GREEN}All good \xe2\x80\x94 the portal is up, healthy, and fully migrated.${RST}\n"
    return 0
  else
    printf "${RED}%d check(s) failed.${RST} 'docker compose logs -f %s' has the details.\n" "$FAILED" "$SERVICE"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# migrate — apply pending migrations on demand, then confirm
# ---------------------------------------------------------------------------
do_migrate() {
  goto_deploy_dir
  need_docker
  echo "==> Applying database migrations"
  local state
  state="$(docker inspect -f '{{.State.Status}}' "$CONTAINER_PORTAL" 2>/dev/null || echo missing)"
  if [ "$state" != "running" ]; then
    bad "portal container is not running (state: $state)"
    info "start the stack first:  ./install.sh update   (or: docker compose up -d)"
    exit 1
  fi
  if ! docker exec "$CONTAINER_DB" pg_isready -U portal >/dev/null 2>&1; then
    bad "database is not accepting connections yet — wait for '$CONTAINER_DB' to be healthy and retry"; exit 1
  fi
  echo ""
  echo "  Current status:"
  docker compose exec -T "$SERVICE" node_modules/.bin/prisma migrate status 2>&1 | sed 's/^/    /' || true
  echo ""
  if docker compose exec -T "$SERVICE" node_modules/.bin/prisma migrate deploy; then
    ok "migrate deploy completed"
  else
    echo ""; bad "migrate deploy failed — no partial state is left applied, but the schema is NOT current"
    info "check the app log for the failing statement:  docker logs $CONTAINER_PORTAL"; exit 1
  fi
  if docker compose exec -T "$SERVICE" node_modules/.bin/prisma migrate status >/dev/null 2>&1; then
    ok "database schema is up to date (all migrations applied)"
    echo ""; printf "${GREEN}Done \xe2\x80\x94 migrations are all good.${RST}\n"
  else
    echo ""; bad "schema still reports pending/failed migrations after deploy — investigate before relying on the app"; exit 1
  fi
}

# ---------------------------------------------------------------------------
# setup — first-time bootstrap of .env, reverse proxy, stack, health
# ---------------------------------------------------------------------------
do_setup() {
  goto_deploy_dir
  set -e
  local CURRENT_STEP="startup"
  on_err() { local rc=$?; echo ""; echo "!! setup failed during: ${CURRENT_STEP} (exit ${rc})"; echo "   Fix the cause above, then re-run ./install.sh setup — it resumes from here."; exit "$rc"; }
  trap on_err ERR
  need_docker

  # --- 1. .env ---
  CURRENT_STEP="creating .env"
  reconcile_env() {
    local envf="$1" example="$2" added=0 key value
    while IFS= read -r key; do
      grep -q "^${key}=" "$envf" && continue
      value="$(sed -n "s/^${key}=//p" "$example" | head -1 | tr -d '"')"
      case "$key" in
        POSTGRES_PASSWORD) value="$(openssl rand -hex 24)";;
        ADMIN_SECRET) value="$(openssl rand -hex 32)";;
        ADMIN_PASSWORD) value="$(openssl rand -hex 12)";;
      esac
      { echo ""; echo "# Added by setup reconcile ($(date -u +%F)) — new since this .env was created; see .env.example"; echo "${key}=\"${value}\""; } >>"$envf"
      echo "    added missing ${key}"; added=1
    done < <(grep -oE '^[A-Z_]+=' "$example" | sed 's/=$//')
    [ "$added" = 0 ] && echo "    ${envf} already has every key from ${example}."
    return 0
  }

  GENERATED_ADMIN_PASSWORD=""
  if [ ! -f .env ]; then
    echo "==> No .env found — creating one from .env.example"
    cp .env.example .env
    GENERATED_ADMIN_PASSWORD="$(openssl rand -hex 12)"
    sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=\"$(openssl rand -hex 24)\"/" .env
    sed -i "s/^ADMIN_SECRET=.*/ADMIN_SECRET=\"$(openssl rand -hex 32)\"/" .env
    sed -i "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=\"$GENERATED_ADMIN_PASSWORD\"/" .env
    echo "    Generated POSTGRES_PASSWORD, ADMIN_SECRET, and ADMIN_PASSWORD."
    # Follow a non-stable line if the bootstrap asked for one.
    case "$CHANNEL" in
      develop|nightly)
        if grep -q '^IMAGE_TAG=' .env; then sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=\"${CHANNEL}\"/" .env
        else printf '\nIMAGE_TAG="%s"\n' "$CHANNEL" >> .env; fi
        echo "    IMAGE_TAG set to \"${CHANNEL}\" (following the ${CHANNEL} line)." ;;
    esac
    echo "    Next you choose whether to run the bundled Traefik reverse proxy;"
    echo "    everything else (UniFi controller, URLs, certs) is configured after"
    echo "    first boot in the admin GUI. See README.md 'First-time setup'."
    [ -t 0 ] && read -rp "    Press Enter to continue (Ctrl+C to stop and edit .env first)... " _
  else
    echo "==> Using existing .env — checking for keys added since it was created"
    reconcile_env .env .env.example
  fi

  # --- 2. reverse proxy ---
  CURRENT_STEP="choosing the reverse proxy"
  port_holder() { ss -ltnp 2>/dev/null | awk -v p=":$1" '$4 ~ p"$" {print $NF; exit}'; }
  mkdir -p traefik && chown 1000:1000 traefik 2>/dev/null || true
  if grep -qE '^COMPOSE_PROFILES=.*\btraefik\b' .env 2>/dev/null; then
    echo "==> Bundled Traefik already enabled — keeping it."
  elif sed -n '/portal:/,/traefik:/p' "$COMPOSE_FILE" | grep -q '^[[:space:]]*ports:'; then
    echo "==> Portal is published directly (ports mapping enabled) — keeping that."
  else
    local INSTALL_TRAEFIK=1 REPLY_TRAEFIK
    if [ -t 0 ]; then
      echo "==> Reverse proxy: the bundled Traefik serves your guest/admin hostnames over"
      echo "    HTTPS (Let's Encrypt via Cloudflare DNS-01), managed from the admin GUI."
      echo "    Say no if you already run a reverse proxy."
      read -rp "    Install the bundled Traefik? [Y/n] " REPLY_TRAEFIK
      case "$REPLY_TRAEFIK" in n|N) INSTALL_TRAEFIK=0;; esac
    fi
    if [ "$INSTALL_TRAEFIK" = 1 ]; then
      local p holder
      for p in 80 443; do
        holder="$(port_holder "$p" || true)"
        if [ -n "$holder" ]; then
          echo "!! Port ${p} is already in use by: ${holder}"
          echo "   Free it (or answer 'n'), then re-run ./install.sh setup."; exit 1
        fi
      done
      if grep -q '^COMPOSE_PROFILES=' .env; then
        local cur new
        cur="$(sed -n 's/^COMPOSE_PROFILES="\{0,1\}\([^"]*\)"\{0,1\}.*/\1/p' .env | head -1)"
        if [ -z "$cur" ]; then new="traefik"; else new="${cur},traefik"; fi
        sed -i "s|^COMPOSE_PROFILES=.*|COMPOSE_PROFILES=\"${new}\"|" .env
      else
        printf '\n# Enable the bundled Traefik reverse proxy service (setup choice).\nCOMPOSE_PROFILES="traefik"\n' >> .env
      fi
      echo "    Bundled Traefik enabled. Finish it in the GUI: Settings -> URLs -> Reverse Proxy."
      local current_admin ADMIN_URL_IN
      current_admin="$(sed -n 's/^ADMIN_BASE_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' .env | head -1)"
      if [ -t 0 ] && [ -z "$current_admin" ]; then
        echo ""
        echo "    Admin URL: the hostname the admin GUI is served on (e.g."
        echo "    https://portal-adm.example.com). Leave blank to browse by IP."
        read -rp "    Admin URL [blank = IP only]: " ADMIN_URL_IN
        if [ -n "$ADMIN_URL_IN" ]; then
          case "$ADMIN_URL_IN" in http://*|https://*) ;; *) ADMIN_URL_IN="https://$ADMIN_URL_IN";; esac
          if grep -q '^ADMIN_BASE_URL=' .env; then sed -i "s|^ADMIN_BASE_URL=.*|ADMIN_BASE_URL=\"$ADMIN_URL_IN\"|" .env
          else printf '\n# Admin GUI URL — seeded into the portal settings on first boot.\nADMIN_BASE_URL="%s"\n' "$ADMIN_URL_IN" >> .env; fi
          echo "    Admin URL saved — point its DNS record at this host."
        fi
      fi
    else
      sed -i 's|^    # ports:|    ports:|; s|^    #   - "80:3000"|      - "80:3000"|' "$COMPOSE_FILE"
      echo "    Portal will publish on host port 80 directly."
    fi
  fi

  # --- 3. image pull ---
  CURRENT_STEP="pulling images"
  echo "==> Pulling images..."
  registry_login
  pull_with_retry

  # --- 4a. verify DB credentials before booting the app ---
  CURRENT_STEP="verifying database credentials"
  echo "==> Verifying database credentials..."
  load_env
  docker compose up -d db
  local i
  for i in $(seq 1 30); do
    docker compose exec -T db pg_isready -U portal -d portal >/dev/null 2>&1 && break
    [ "$i" = 30 ] && { echo "!! the database container never became ready" >&2; exit 1; }
    sleep 2
  done
  if ! docker compose exec -T -e PGPASSWORD="${POSTGRES_PASSWORD:-}" db \
      sh -c 'psql -h "$(hostname -i)" -U portal -d portal -c "SELECT 1"' >/dev/null 2>&1; then
    echo "    Realigning the database user to the .env password (existing data untouched)."
    printf "ALTER USER portal WITH PASSWORD '%s';\n" "$(printf %s "${POSTGRES_PASSWORD:-}" | sed "s/'/''/g")" \
      | docker compose exec -T db psql -U portal -d portal -q
    docker compose exec -T -e PGPASSWORD="${POSTGRES_PASSWORD:-}" db \
      sh -c 'psql -h "$(hostname -i)" -U portal -d portal -c "SELECT 1"' >/dev/null 2>&1 \
      || { echo "!! realignment failed — check .env POSTGRES_PASSWORD manually" >&2; exit 1; }
    echo "    Database credentials realigned."
  fi

  # --- 4. bring up ---
  CURRENT_STEP="starting containers"
  echo "==> Starting containers (migrations run on boot)..."
  docker compose up -d

  # --- 5. wait for health ---
  CURRENT_STEP="waiting for containers to become healthy"
  echo "==> Waiting for health..."
  local name status
  for name in "$CONTAINER_DB" "$CONTAINER_PORTAL"; do
    status=""
    for _ in $(seq 1 30); do
      status="$(docker inspect "$name" --format '{{.State.Health.Status}}' 2>/dev/null || true)"
      [ "$status" = "healthy" ] && break
      sleep 2
    done
    [ "$status" = "healthy" ] || { echo "!! $name never became healthy — check: docker logs $name"; exit 1; }
    echo "    $name: healthy"
  done
  trap - ERR
  set +e
  echo "==> Done."

  # --- 6. all-good check + first-login info ---
  echo ""
  do_verify || true

  local HOST_IP
  HOST_IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<NF;i++) if ($i=="src") {print $(i+1); exit}}')"
  echo ""
  echo "    First-time admin login:"
  if [ -n "${ADMIN_BASE_URL:-}" ]; then
    echo "      URL:      ${ADMIN_BASE_URL}/admin/login"
    [ -n "$HOST_IP" ] && echo "                (or http://${HOST_IP}/admin/login until DNS points here)"
  elif [ -n "$HOST_IP" ]; then
    echo "      URL:      http://${HOST_IP}/admin/login"
  else
    echo "      URL:      http://<this-host's-LAN-IP>/admin/login"
  fi
  echo "      Username: (leave blank)"
  if [ -n "$GENERATED_ADMIN_PASSWORD" ]; then
    echo "      Password: $GENERATED_ADMIN_PASSWORD"
  else
    echo "      Password: ADMIN_PASSWORD in .env (recovery password)"
  fi
  echo "    Logging in creates your personal admin account — after that this"
  echo "    password stops working. See README.md 'First-time setup'."
  echo ""
  echo "    Next: backup cron (README 'Backups & health') · go-live checklist (docs/GO-LIVE.md)"
}

# ---------------------------------------------------------------------------
# update — pull the newest image, restart, health-check, verify migrations, prune
# ---------------------------------------------------------------------------
do_update() {
  goto_deploy_dir
  need_docker
  set -e
  echo "==> Disk before:"; df -h / | awk 'NR==1 || /\//{print}'
  echo "==> Pulling latest image..."
  registry_login
  local all_services
  if ! all_services="$(docker compose config --services)"; then
    echo "!! 'docker compose config' failed — fix the compose/.env error and re-run." >&2; exit 1
  fi
  local SERVICES=("$SERVICE") CONTAINERS=("$CONTAINER_PORTAL")
  if grep -qx "portal-admin" <<<"$all_services"; then SERVICES+=(portal-admin); CONTAINERS+=(unifi-captive-portal-admin); fi
  pull_with_retry "$SERVICE"
  echo "==> Restarting container(s) (migrations run on boot)..."
  docker compose up -d "${SERVICES[@]}"
  grep -qx "traefik-ops" <<<"$all_services" && docker compose restart traefik-ops >/dev/null 2>&1 || true

  echo "==> Waiting for health..."
  local c ip health
  for c in "${CONTAINERS[@]}"; do
    ip="$(docker inspect "$c" --format '{{range .NetworkSettings.Networks}}{{if .IPAddress}}{{.IPAddress}} {{end}}{{end}}' | awk '{print $1}')"
    health=""
    for _ in $(seq 1 20); do sleep 3; health="$(curl -fsS "http://${ip}:3000/api/health" 2>/dev/null || true)"; [ -n "$health" ] && break; done
    [ -n "$health" ] || { echo "!! Health check never responded for $c — NOT pruning (images kept for rollback). Check: docker logs $c"; exit 1; }
    echo "    $c: $health"
  done

  echo "==> Verifying DB migrations..."
  local migrate_out
  if migrate_out="$(docker compose exec -T "$SERVICE" node_modules/.bin/prisma migrate status 2>&1)"; then
    echo "    Database schema is up to date."
  else
    echo "$migrate_out" | sed 's/^/    /'
    echo "!! The DB schema is NOT fully migrated — the app is up but may misbehave. Check: docker logs $CONTAINER_PORTAL"
  fi

  # prune: dangling, superseded per-commit tags (keep newest few), old build cache
  docker image prune -f >/dev/null
  local running_imgs="" entry tag rest id i=0
  for c in "${CONTAINERS[@]}"; do running_imgs+=" $(docker inspect "$c" --format '{{.Image}}' 2>/dev/null || true)"; done
  local sha_tags
  mapfile -t sha_tags < <(docker images "$REPO" --format '{{.Tag}} {{.ID}} {{.CreatedAt}}' | grep -vE '^(latest|develop|nightly) ' | sort -k3 -r)
  for entry in "${sha_tags[@]}"; do
    tag="${entry%% *}"; rest="${entry#* }"; id="${rest%% *}"; i=$((i+1))
    [ "$i" -le "$KEEP_IMAGES" ] && continue
    case "$running_imgs" in *"$id"*) continue;; esac
    docker rmi "$REPO:$tag" >/dev/null 2>&1 && echo "    removed $REPO:$tag" || true
  done
  docker builder prune -f --filter "until=$CACHE_KEEP" >/dev/null 2>&1 || docker builder prune -f >/dev/null 2>&1 || true
  echo "==> Disk after:"; df -h / | awk 'NR==1 || /\//{print}'
  echo "==> Done."
}

# ---------------------------------------------------------------------------
# channel — follow a release line by pinning IMAGE_TAG, then update
# ---------------------------------------------------------------------------
do_channel() {
  goto_deploy_dir
  local line="${1:-}" tag reply
  case "$line" in
    main) tag="" ;;
    develop) tag="develop" ;;
    nightly)
      tag="nightly"
      echo "!! nightly is the ungated line (no tests or scanners). Never point a host you care about at it."
      if [ -t 0 ]; then read -rp "   Follow nightly anyway? [y/N] " reply; case "$reply" in y|Y) ;; *) echo "aborted"; exit 1;; esac; fi ;;
    *) echo "usage: ./install.sh channel <main|develop|nightly>"; exit 1 ;;
  esac
  [ -f .env ] || { echo "!! .env missing — run ./install.sh setup first"; exit 1; }
  if grep -q '^IMAGE_TAG=' .env; then sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=\"${tag}\"/" .env
  else printf '\n# Release line to follow (main=:latest, develop, nightly).\nIMAGE_TAG="%s"\n' "$tag" >> .env; fi
  echo "==> Following the '${line}' line (IMAGE_TAG=\"${tag:-latest}\")."
  do_update
}

# ---------------------------------------------------------------------------
# backup / restore
# ---------------------------------------------------------------------------
do_backup() {
  goto_deploy_dir
  need_docker
  local KEEP_DAYS="${KEEP_DAYS:-14}" DISK_WARN_PCT="${DISK_WARN_PCT:-85}"
  docker exec "$CONTAINER_DB" sh -c '
    set -o pipefail
    f=/backups/portal-$(date +%F-%H%M).sql.gz
    if pg_dump -U portal portal | gzip > "$f.tmp"; then mv "$f.tmp" "$f"; echo "wrote $f";
    else rm -f "$f.tmp"; echo "ERROR: pg_dump failed — no backup written" >&2; exit 1; fi'
  docker exec "$CONTAINER_DB" sh -c "find /backups -name 'portal-*.sql.gz' -mtime +$KEEP_DAYS -delete"
  local used; used="$(df --output=pcent / | tr -dc '0-9')"
  [ "${used:-0}" -ge "$DISK_WARN_PCT" ] && echo "WARNING: disk at ${used}% on $(hostname) — './install.sh update' prunes images/cache."
  return 0
}

do_restore() {
  goto_deploy_dir
  need_docker
  load_env
  local BACKUP_DIR="${BACKUP_PATH:-./backups}" dump ans
  dump="${1:-}"
  if [ -z "$dump" ]; then
    dump="$(ls -1t "$BACKUP_DIR"/portal-*.sql.gz 2>/dev/null | head -1 || true)"
    [ -z "$dump" ] && { echo "!! No dumps found in $BACKUP_DIR"; exit 1; }
    echo "==> Newest dump: $dump"
  fi
  [ -f "$dump" ] || { echo "!! Not found: $dump"; exit 1; }
  docker inspect "$CONTAINER_DB" >/dev/null 2>&1 || { echo "!! DB container '$CONTAINER_DB' is not running"; exit 1; }
  echo ""
  echo "    Restore '$dump' into '$CONTAINER_DB' database 'portal'."
  echo "    This OVERWRITES the current database — all data since this dump is lost."
  if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_PORTAL" 2>/dev/null || echo false)" = "true" ]; then
    echo "    !! The app is still RUNNING — stop it first:  docker compose stop portal"
  fi
  read -rp "    Type 'restore' to proceed: " ans
  [ "$ans" = "restore" ] || { echo "aborted"; exit 1; }
  echo "==> Resetting schema..."
  docker exec -i "$CONTAINER_DB" psql -v ON_ERROR_STOP=1 -U portal -d portal -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  echo "==> Restoring..."
  gunzip -c "$dump" | docker exec -i "$CONTAINER_DB" psql -v ON_ERROR_STOP=1 -U portal -d portal >/dev/null
  echo "==> Done. Start the app if you stopped it:  docker compose start portal"
}

# ---------------------------------------------------------------------------
# install — bootstrap a fresh host (fetch files + run setup)
# ---------------------------------------------------------------------------
do_install() {
  local branch="${1:-main}" base
  case "$branch" in main|develop|nightly) ;; *) echo "!! unknown line '$branch' (expected main, develop, or nightly)"; exit 1;; esac
  command -v curl >/dev/null 2>&1 || { echo "!! curl is required."; exit 1; }
  need_docker
  base="https://raw.githubusercontent.com/${REPO_SLUG}/${branch}"

  if [ -f "$0" ]; then
    # Running from a real on-disk install.sh — set up IN PLACE (its own
    # directory), fetching only the files not already there. No nested subdir.
    cd "$(cd "$(dirname "$0")" && pwd)"
    echo "==> Setting up in $(pwd) (line: ${branch})"
    [ -f docker-compose.yml ] || { echo "==> Fetching docker-compose.yml"; curl -fsSLO "$base/docker-compose.yml"; }
    [ -f .env.example ]      || { echo "==> Fetching .env.example";      curl -fsSLO "$base/.env.example"; }
  else
    # Piped in via `bash <(curl ...)`: create a fresh directory, fetch everything
    # (including install.sh so subcommands work afterward).
    local dir="${INSTALL_DIR:-unifi-portal}"
    echo "==> Bootstrapping the UniFi Captive Portal into ./${dir} (line: ${branch})"
    mkdir -p "$dir"; cd "$dir"
    if [ -f docker-compose.yml ] || [ -f .env ]; then
      echo "!! ./${dir} already looks set up. cd in and run: ./install.sh setup"; exit 1
    fi
    echo "==> Fetching docker-compose.yml, .env.example, install.sh"
    curl -fsSL --remote-name-all "$base"/{docker-compose.yml,.env.example,install.sh}
    chmod +x install.sh
  fi
  [ "$branch" != main ] && CHANNEL="$branch"
  echo "==> Running setup"
  do_setup
}

usage() {
  cat <<EOF
install.sh — one command for a UniFi Captive Portal host.

  ./install.sh                 bootstrap (fetch files + run setup); accepts a line arg
  ./install.sh setup           (re)run first-time setup: .env, reverse proxy, up, verify
  ./install.sh verify          read-only health + migration check
  ./install.sh migrate         apply pending DB migrations, then verify
  ./install.sh update          pull the newest image, restart, health-check, prune
  ./install.sh channel <line>  follow main | develop | nightly (sets IMAGE_TAG + update)
  ./install.sh backup          dump the database
  ./install.sh restore [file]  restore the database from a dump (destructive)
  ./install.sh help            this help

One-line remote bootstrap:
  bash <(curl -fsSL https://raw.githubusercontent.com/${REPO_SLUG}/main/install.sh) [main|develop|nightly]
EOF
}

main() {
  local cmd="${1:-install}"
  case "$cmd" in
    setup)          shift; do_setup "$@" ;;
    verify)         shift; do_verify "$@" ;;
    migrate)        shift; do_migrate "$@" ;;
    update|deploy)  shift; do_update "$@" ;;
    channel)        shift; do_channel "$@" ;;
    backup)         shift; do_backup "$@" ;;
    restore)        shift; do_restore "$@" ;;
    help|-h|--help) usage ;;
    install|"")     do_install ;;                 # bootstrap, default line (main)
    main|develop|nightly) do_install "$cmd" ;;    # bootstrap a specific line
    *) echo "!! unknown command: $cmd"; echo; usage; exit 1 ;;
  esac
}

main "$@"
