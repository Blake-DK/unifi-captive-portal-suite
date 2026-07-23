#!/bin/sh
# Interactive enabler for the optional Traefik log dashboard (see
# docs/OPERATIONS.md "Traefik log dashboard"). Generates the agent token,
# asks for the dashboard hostname, patches .env (COMPOSE_PROFILES +
# LOGDASH_*), and brings the stack up. Sign-in needs no setup here: the
# dashboard is gated by the portal's own admin sign-in (forwardAuth).
# Safe to re-run: existing values are offered as defaults. install.sh update offers
# to run this once per host; running it by hand later is the same thing.
set -eu
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "!! No .env here — run on a deployed host (install.sh setup first)."; exit 1; }
[ -t 0 ] || { echo "!! Needs an interactive terminal."; exit 1; }
command -v openssl >/dev/null || { echo "!! openssl is required (token generation)."; exit 1; }

env_get() { sed -n "s/^$1=[\"']\{0,1\}\([^\"']*\)[\"']\{0,1\}\$/\1/p" .env | head -1; }

# Replace or append KEY='value'. SINGLE quotes on purpose: values must stay
# literal for both docker compose's dotenv parser and install.sh update's own
# `set -a; . ./.env` sourcing. sed replacement escapes & \ and the delimiter.
env_set() {
  key="$1"; val="$2"
  esc="$(printf '%s' "$val" | sed 's/[&|\\]/\\&/g')"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}='${esc}'|" .env
  else
    printf "%s='%s'\n" "$key" "$val" >>.env
  fi
}

profiles="$(env_get COMPOSE_PROFILES)"
case ",$profiles," in
  *,traefik,*) : ;;
  *) echo "!! The log dashboard needs the bundled Traefik (COMPOSE_PROFILES=\"traefik\")."
     echo "   This host has COMPOSE_PROFILES=\"${profiles}\" — nothing changed."
     exit 1 ;;
esac

echo "== Traefik log dashboard setup =="
echo "   Access-log analytics (GeoIP, status codes, per-service metrics) on its"
echo "   own hostname. Sign-in is your portal admin account — no extra"
echo "   credentials. Third-party images (hhftechnology/traefik-log-dashboard)."
echo ""

cur_host="$(env_get LOGDASH_HOST)"
printf "Dashboard hostname (DNS must point at this host)%s: " "${cur_host:+ [$cur_host]}"
read -r host
host="${host:-$cur_host}"
[ -n "$host" ] || { echo "!! A hostname is required."; exit 1; }

token="$(env_get LOGDASH_TOKEN)"
[ -n "$token" ] || token="$(openssl rand -hex 24)"
env_set LOGDASH_TOKEN "$token"
env_set LOGDASH_HOST "$host"
case ",$profiles," in
  *,logdash,*) : ;;
  *) env_set COMPOSE_PROFILES "${profiles},logdash" ;;
esac
echo "    .env updated (COMPOSE_PROFILES=\"$(env_get COMPOSE_PROFILES)\")."

# Recreates the portal (its env changed), which rewrites traefik.yml with the
# accessLog block on boot; the traefik-ops sidecar restarts Traefik on that
# change, and the two dashboard containers start under the new profile.
echo "==> docker compose up -d"
docker compose up -d
echo ""
echo "    Done. Once DNS for ${host} points here and the certificate is"
echo "    issued, the dashboard is at https://${host} — sign in with your"
echo "    portal admin account (it redirects through the admin host once)."
echo "    It is also linked at the bottom of the admin sidebar."
