#!/usr/bin/env bash
# First-time bootstrap: create .env, choose the reverse proxy (bundled Traefik
# or your own), pull images, bring up the stack, wait for health.
#
# Safe to re-run: every step is idempotent and checks whether it's already done,
# so if a run fails partway (occupied port, registry auth, a slow image pull)
# you fix the cause and just run ./setup.sh again — it picks up from the
# first unfinished step rather than starting over.
#
# For redeploying an already-running host after CI publishes a new image, use
# ./deploy.sh instead (pull latest, restart, health-check, prune old images).
#
# Usage:  ./setup.sh
set -euo pipefail

cd "$(dirname "$0")"

CONTAINER_DB="unifi-captive-portal-db"
CONTAINER_PORTAL="unifi-captive-portal"
COMPOSE_FILE="docker-compose.yml"

# On any unexpected failure, point back at this same script — because every step
# is idempotent, re-running resumes rather than repeating work.
CURRENT_STEP="startup"
on_err() {
  local rc=$?
  echo ""
  echo "!! setup failed during: ${CURRENT_STEP} (exit ${rc})"
  echo "   Fix the cause above, then re-run ./setup.sh — it resumes from here"
  echo "   (finished steps detect they're already done and skip)."
  exit "$rc"
}
trap on_err ERR

command -v docker >/dev/null || { echo "!! docker is not installed"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "!! docker compose plugin is not installed"; exit 1; }

# --- 1. .env ---------------------------------------------------------------
CURRENT_STEP="creating .env"

# Append any KEY present in .env.example but missing from .env — keys added by
# releases newer than this install would otherwise silently stay unset and the
# features behind them (pull token, update check, …) never work. Existing
# values are NEVER touched; absent secrets are generated, everything else
# takes the example's default. Same helper in update.sh — keep them in sync.
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
    {
      echo ""
      echo "# Added by setup/update reconcile ($(date -u +%F)) — new since this .env was created; see .env.example"
      echo "${key}=\"${value}\""
    } >>"$envf"
    echo "    added missing ${key} (see the comment above it in ${envf})"
    added=1
  done < <(grep -oE '^[A-Z_]+=' "$example" | sed 's/=$//')
  if [ "$added" = 0 ]; then
    echo "    ${envf} already has every key from ${example}."
  fi
  return 0
}

# Fill a BLANK IMAGE_TAG to match a develop/nightly checkout, so the host
# follows its branch's image line instead of silently pulling :latest
# (compose treats empty as latest). An explicit non-blank IMAGE_TAG is an
# operator choice and is never touched; main checkouts stay blank (:latest).
# Same helper in update.sh — keep them in sync.
align_image_tag() {
  local branch
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  case "$branch" in develop|nightly) ;; *) return 0;; esac
  if grep -q '^IMAGE_TAG=' .env 2>/dev/null; then
    grep -q '^IMAGE_TAG=""' .env || grep -q "^IMAGE_TAG=''" .env || return 0
    sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=\"${branch}\"/" .env
  else
    printf '\n# Image line matching the git checkout (auto-set by setup.sh/update.sh).\nIMAGE_TAG="%s"\n' "$branch" >> .env
  fi
  echo "    IMAGE_TAG set to \"${branch}\" to match the checked-out branch."
  return 0
}

GENERATED_ADMIN_PASSWORD=""
if [ ! -f .env ]; then
  echo "==> No .env found — creating one from .env.example"
  cp .env.example .env
  # ADMIN_PASSWORD is the first-time-setup/recovery password (README "First-time
  # setup") — printed once below. It's an accepted tradeoff that this lands in
  # terminal scrollback/session logs; it's already a standing plaintext value in
  # .env regardless (README "Recovery"), so there's no stronger secret to protect
  # by withholding it here.
  GENERATED_ADMIN_PASSWORD="$(openssl rand -hex 12)"
  sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=\"$(openssl rand -hex 24)\"/" .env
  sed -i "s/^ADMIN_SECRET=.*/ADMIN_SECRET=\"$(openssl rand -hex 32)\"/" .env
  sed -i "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=\"$GENERATED_ADMIN_PASSWORD\"/" .env
  echo "    Generated POSTGRES_PASSWORD, ADMIN_SECRET, and ADMIN_PASSWORD."
  align_image_tag
  echo "    Next you choose whether to run the bundled Traefik reverse proxy"
  echo "    and, if so, the admin URL it should route from first boot — the"
  echo "    portal publishes no host port of its own in that mode."
  echo "       Everything else — UniFi controller, guest defaults, portal/guest"
  echo "       URLs, certificates — is configured after first boot in the admin"
  echo "       GUI (Settings); see README.md 'First-time setup', not .env."
  echo "       Optional: set GHCR_PULL_USER/GHCR_PULL_TOKEN in .env now to skip"
  echo "       the interactive registry login prompt below."
  read -rp "    Press Enter to continue (Ctrl+C to stop and edit .env first)... " _
else
  echo "==> Using existing .env — checking for keys added since it was created"
  reconcile_env .env .env.example
  align_image_tag
fi

# --- 2. reverse proxy --------------------------------------------------------
# The stack is plain bridge networking: the bundled Traefik (compose profile
# "traefik") publishes host ports 80/443 and reaches the portal by service
# name. Everything configurable about it (Cloudflare token, ACME email,
# hostnames, extra resources) lives in the admin GUI — the only decision here
# is whether the container runs at all. Idempotent: an already-made choice is
# detected and kept.
CURRENT_STEP="choosing the reverse proxy"

port_holder() { # <port> — name the process listening on it, if any
  ss -ltnp 2>/dev/null | awk -v p=":$1" '$4 ~ p"$" {print $NF; exit}'
}

# The portal container runs as uid 1000 (non-root) and writes the bundled
# Traefik's config into ./traefik — make sure the bind-mount dir exists with
# the right owner before docker creates it root-owned.
mkdir -p traefik && chown 1000:1000 traefik 2>/dev/null || true

if grep -qE '^COMPOSE_PROFILES=.*\btraefik\b' .env 2>/dev/null; then
  # Match "traefik" as a MEMBER, so a split host (COMPOSE_PROFILES="traefik,split")
  # is recognised and its other profiles are left intact by a re-run.
  echo "==> Bundled Traefik already enabled (COMPOSE_PROFILES in .env) — keeping it."
  INSTALL_TRAEFIK=1
elif grep -q '^[[:space:]]*ports:' "$COMPOSE_FILE" | head -1 >/dev/null 2>&1 &&      sed -n '/portal:/,/traefik:/p' "$COMPOSE_FILE" | grep -q '^[[:space:]]*ports:'; then
  echo "==> Portal is published directly (ports mapping enabled) — keeping that."
  INSTALL_TRAEFIK=0
else
  INSTALL_TRAEFIK=1
  if [ -t 0 ]; then
    echo "==> Reverse proxy: the bundled Traefik serves your guest/admin hostnames"
    echo "    over HTTPS (Let's Encrypt via Cloudflare DNS-01) and is managed from"
    echo "    the admin GUI. Say no if you already run a reverse proxy — the GUI"
    echo "    then shows you a config snippet for it instead."
    read -rp "    Install the bundled Traefik? [Y/n] " REPLY_TRAEFIK
    case "$REPLY_TRAEFIK" in n|N) INSTALL_TRAEFIK=0;; esac
  fi
  if [ "$INSTALL_TRAEFIK" = 1 ]; then
    for p in 80 443; do
      holder="$(port_holder "$p" || true)"
      if [ -n "$holder" ]; then
        echo "!! Port ${p} is already in use on this host by: ${holder}"
        echo "   Free it (or answer 'n' to skip the bundled Traefik), then re-run ./setup.sh."
        exit 1
      fi
    done
    if grep -q '^COMPOSE_PROFILES=' .env; then
      # Add "traefik" as a member, preserving any other profiles already set
      # (e.g. "split") instead of overwriting the whole value. We only reach
      # here when traefik is NOT already present (the grep above skips otherwise).
      cur_profiles="$(sed -n 's/^COMPOSE_PROFILES="\{0,1\}\([^"]*\)"\{0,1\}.*/\1/p' .env | head -1)"
      if [ -z "$cur_profiles" ]; then new_profiles="traefik"; else new_profiles="${cur_profiles},traefik"; fi
      sed -i "s|^COMPOSE_PROFILES=.*|COMPOSE_PROFILES=\"${new_profiles}\"|" .env
    else
      printf '\n# Enable the bundled Traefik reverse proxy service (setup.sh choice).\nCOMPOSE_PROFILES="traefik"\n' >> .env
    fi
    echo "    Bundled Traefik enabled. Finish its setup in the GUI after first boot:"
    echo "    Settings -> URLs -> Reverse Proxy (ACME email, Cloudflare token)."
    # In this mode the portal itself publishes no host port — everything
    # arrives through Traefik. Ask for the admin URL now and seed it (plus
    # mode "bundled") into the portal's settings on first boot, so the admin
    # GUI is routable before anyone has ever signed in to configure routing.
    # The bare-IP catch-all on :80 reaches /admin too (URL printed at the end).
    current_admin="$(sed -n 's/^ADMIN_BASE_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' .env | head -1)"
    if [ -t 0 ] && [ -z "$current_admin" ]; then
      echo ""
      echo "    Admin URL: the hostname the admin GUI is served on, routed by the"
      echo "    bundled Traefik from first boot (e.g. https://portal-adm.example.com;"
      echo "    the HTTPS certificate is issued once the Cloudflare token is set in"
      echo "    the GUI). Leave blank to browse by this host's IP instead."
      read -rp "    Admin URL [blank = IP only]: " ADMIN_URL_IN
      if [ -n "$ADMIN_URL_IN" ]; then
        case "$ADMIN_URL_IN" in http://*|https://*) ;; *) ADMIN_URL_IN="https://$ADMIN_URL_IN";; esac
        if grep -q '^ADMIN_BASE_URL=' .env; then
          sed -i "s|^ADMIN_BASE_URL=.*|ADMIN_BASE_URL=\"$ADMIN_URL_IN\"|" .env
        else
          printf '\n# Admin GUI URL — seeded into the portal settings on first boot (setup.sh).\nADMIN_BASE_URL="%s"\n' "$ADMIN_URL_IN" >> .env
        fi
        echo "    Admin URL saved — point its DNS record at this host."
      fi
    fi
  else
    # No bundled proxy: publish the portal itself on host port 80 so guests
    # (and an external proxy) can reach it.
    sed -i 's|^    # ports:|    ports:|; s|^    #   - "80:3000"|      - "80:3000"|' "$COMPOSE_FILE"
    echo "    Portal will publish on host port 80 directly. If you run your own"
    echo "    Traefik, grab the ready-made provider snippet after first boot:"
    echo "    Settings -> URLs -> Reverse Proxy (mode External)."
  fi
fi

# --- 3. registry auth + image pull -----------------------------------------
CURRENT_STEP="pulling images"
echo "==> Pulling images..."
# GHCR requires authentication to pull packages from private repos — there's
# no anonymous access to them. On a fresh host with no cached registry
# credentials this fails with "unauthorized"; if so, prompt for a one-time
# login (GitHub username + PAT with read:packages) and retry. Once
# logged in, Docker caches the credentials for future runs (this script,
# deploy.sh) so this only happens once per host.
#
# If GHCR_PULL_TOKEN is set in .env, log in with it non-interactively up
# front instead — the pull below then just succeeds and the interactive
# fallback never triggers.
# shellcheck disable=SC1091
[ -f .env ] && set -a && . ./.env && set +a
if [ -n "${GHCR_PULL_TOKEN:-}" ]; then
  echo "    Logging in to the registry with the configured pull token..."
  echo "$GHCR_PULL_TOKEN" | docker login ghcr.io -u "${GHCR_PULL_USER:-blakey108}" --password-stdin
fi

pull_log="$(mktemp)"
if ! docker compose pull 2>&1 | tee "$pull_log"; then
  if grep -qi unauthorized "$pull_log"; then
    rm -f "$pull_log"
    echo "    Registry needs authentication — log in with your GitHub username + PAT (read:packages):"
    docker login ghcr.io
    docker compose pull
  else
    rm -f "$pull_log"
    exit 1
  fi
else
  rm -f "$pull_log"
fi

# --- 4a. verify DB credentials before booting the app -----------------------
# An existing Postgres data volume remembers the password it was initialised
# with. A fresh checkout regenerates POSTGRES_PASSWORD in .env, and the app
# then crash-loops on Prisma P1000 against its own data (seen on the
# prod v1->v3 reinstall, 2026-07-08). The official postgres image trusts
# local-socket superuser connections, so a mismatch can be repaired in place
# by realigning the DB user's password to .env — no old password needed,
# data untouched.
CURRENT_STEP="verifying database credentials"
echo "==> Verifying database credentials..."
docker compose up -d db
for i in $(seq 1 30); do
  docker compose exec -T db pg_isready -U portal -d portal >/dev/null 2>&1 && break
  [ "$i" = 30 ] && { echo "!! the database container never became ready" >&2; exit 1; }
  sleep 2
done
# Probe over the container's own (non-loopback) address: loopback and
# socket connections are trust-authenticated in the official image, so
# only a network connection actually verifies the password — which is
# exactly how the app connects.
if ! docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
    sh -c 'psql -h "$(hostname -i)" -U portal -d portal -c "SELECT 1"' >/dev/null 2>&1; then
  echo "    The password in .env does not match the existing data volume"
  echo "    (a reinstalled checkout regenerated it). Realigning the database"
  echo "    user to the .env value — existing data is untouched."
  # Single quotes doubled = complete escaping for a SQL string literal.
  printf "ALTER USER portal WITH PASSWORD '%s';\n" \
    "$(printf %s "$POSTGRES_PASSWORD" | sed "s/'/''/g")" \
    | docker compose exec -T db psql -U portal -d portal -q
  docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
    sh -c 'psql -h "$(hostname -i)" -U portal -d portal -c "SELECT 1"' >/dev/null 2>&1 \
    || { echo "!! realignment failed — check .env POSTGRES_PASSWORD manually" >&2; exit 1; }
  echo "    Database credentials realigned."
fi

# --- 4. bring up the stack -------------------------------------------------
CURRENT_STEP="starting containers"
echo "==> Starting containers (migrations run on boot)..."
docker compose up -d

# --- 5. wait for health ----------------------------------------------------
CURRENT_STEP="waiting for containers to become healthy"
echo "==> Waiting for health..."
for name in "$CONTAINER_DB" "$CONTAINER_PORTAL"; do
  status=""
  for _ in $(seq 1 30); do
    status="$(docker inspect "$name" --format '{{.State.Health.Status}}' 2>/dev/null || true)"
    [ "$status" = "healthy" ] && break
    sleep 2
  done
  if [ "$status" != "healthy" ]; then
    echo "!! $name never became healthy — check: docker logs $name"
    exit 1
  fi
  echo "    $name: healthy"
done

trap - ERR
echo "==> Done."

# --- 6. first-login info ---------------------------------------------------
# Surface the first-boot admin password whether it was generated on this run or
# a previous one (a mid-run failure must not lose it). It's still valid only
# until the first admin account is created; after that it stops working.
# The portal (or the bundled Traefik in front of it) publishes on this host.
HOST_IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<NF;i++) if ($i=="src") {print $(i+1); exit}}')"
echo ""
echo "    First-time admin login:"
if [ -n "${ADMIN_BASE_URL:-}" ]; then
  echo "      URL:      ${ADMIN_BASE_URL}/admin/login"
  if [ -n "$HOST_IP" ]; then
    echo "                (or http://${HOST_IP}/admin/login until DNS points here)"
  fi
elif [ -n "$HOST_IP" ]; then
  echo "      URL:      http://${HOST_IP}/admin/login"
else
  echo "      URL:      http://<this-host's-LAN-IP>/admin/login"
fi
echo "      Username: (leave blank)"
if [ -n "$GENERATED_ADMIN_PASSWORD" ]; then
  echo "      Password: $GENERATED_ADMIN_PASSWORD"
else
  echo "      Password: ADMIN_PASSWORD in .env (set on first setup; recovery password)"
fi
echo "    Logging in creates your personal admin account — after that, this"
echo "    password stops working. See README.md 'First-time setup'."

echo ""
echo "    Next steps:"
echo "    - Install the nightly backup cron: see README.md 'Backups & health'"
echo "    - Full pre-launch checklist: docs/GO-LIVE.md"
