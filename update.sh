#!/usr/bin/env bash
# Routine update for an installed host: refresh the repo checkout (compose
# file, scripts — where setup.sh/deploy.sh fixes land), pull the newest image,
# and restart ONLY when something actually changed, so running this from cron
# or by habit costs no downtime when there's nothing new.
#
# Division of labour: setup.sh installs, deploy.sh (re)deploys unconditionally,
# update.sh decides whether a deploy is needed at all — and delegates the
# actual deploy (restart, health-check, prune) to the freshly-pulled deploy.sh.
#
# Usage:  ./update.sh
set -euo pipefail

# Append any KEY present in .env.example but missing from .env — keys added by
# releases newer than this install would otherwise silently stay unset and the
# features behind them (pull token, update check, …) never work. Existing
# values are NEVER touched; absent secrets are generated, everything else
# takes the example's default. Same helper in setup.sh — keep them in sync.
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

# Fill a BLANK IMAGE_TAG to match a develop/nightly checkout — compose treats
# empty as :latest, so a blank value on those branches silently tracks the
# wrong image line. Explicit values are operator choice and never touched.
# Same helper in setup.sh — keep them in sync.
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

# One-time interactive offer for the optional Traefik log dashboard (see
# docs/OPERATIONS.md). Fires only on a terminal — the 04:30 cron and @reboot
# runs sail past — and only while the feature is neither enabled nor
# configured. "never" writes LOGDASH_PROMPT="off" so it stays quiet for good;
# scripts/enable-logdash.sh remains the manual path either way.
offer_logdash() {
  [ -t 0 ] || return 0
  grep -q '^COMPOSE_PROFILES=.*traefik' .env 2>/dev/null || return 0
  grep -q '^COMPOSE_PROFILES=.*logdash' .env && return 0
  [ -z "$(sed -n 's/^LOGDASH_HOST="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' .env | head -1)" ] || return 0
  grep -q '^LOGDASH_PROMPT="off"' .env && return 0
  echo ""
  echo "==> Optional feature available: Traefik log dashboard — access-log analytics"
  echo "    (GeoIP, status codes, per-service metrics) on its own hostname, signed"
  echo "    in with your portal admin account. See docs/OPERATIONS.md \"Traefik log dashboard\"."
  printf "    Enable it now? [y/N/never] "
  local ans=""
  read -r ans || true
  case "$ans" in
    y|Y|yes)
      sh scripts/enable-logdash.sh || echo "    !! Setup did not finish — run scripts/enable-logdash.sh to retry."
      ;;
    never)
      printf '\n# Set by update.sh: do not offer the Traefik log dashboard again.\nLOGDASH_PROMPT="off"\n' >>.env
      echo "    Understood — this offer will not repeat (scripts/enable-logdash.sh still works)."
      ;;
    *)
      echo "    Skipped — enable any time with: ./scripts/enable-logdash.sh (answer \"never\" to stop asking)."
      ;;
  esac
  return 0
}

# The whole script is parsed before anything runs (main at the bottom), so the
# `git pull` replacing this very file mid-run can't corrupt the executing copy;
# if update.sh itself changed, we re-exec the new one (once).
main() {
  cd "$(dirname "$0")"

  local REPO="ghcr.io/blake-dk/unifi-captiveportal"
  # Tag this host tracks (compose reads the same var): latest for main
  # checkouts, develop/nightly for those branches' own image lines.
  local IMAGE_TAG_DEFAULT
  case "$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" in
    develop|nightly) IMAGE_TAG_DEFAULT="$(git rev-parse --abbrev-ref HEAD)";;
    *) IMAGE_TAG_DEFAULT=latest;;
  esac
  local SERVICE="portal"
  local CONTAINER="unifi-captive-portal"
  local COMPOSE_FILE="docker-compose.yml"

  # --- 0. wait for Docker ----------------------------------------------------
  # An `@reboot` cron run (README "Backups & health" → Updates) fires before
  # dockerd is up; waiting here also gives the network time to settle for the
  # git pull below. No-op when the daemon already responds.
  command -v docker >/dev/null || { echo "!! docker is not installed"; exit 1; }
  local d
  for d in $(seq 1 30); do
    docker info >/dev/null 2>&1 && break
    if [ "$d" = 30 ]; then
      echo "!! Docker daemon not responding after 5 minutes — giving up."
      exit 1
    fi
    [ "$d" = 1 ] && echo "==> Waiting for the Docker daemon..."
    sleep 10
  done

  # --- 1. refresh the repo checkout ----------------------------------------
  local old_head new_head repo_changed=0
  if [ -z "${UPDATE_SH_REEXEC:-}" ]; then
    command -v git >/dev/null || { echo "!! git is not installed"; exit 1; }
    local branch
    branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
    # main (stable, :latest), develop (integration, :develop) and nightly
    # (ungated fast line, :nightly) are the followable lines; anything else
    # is a feature checkout we must not touch.
    case "$branch" in
      main|develop|nightly) ;;
      *)
        echo "!! Checkout is on '${branch}', not main/develop/nightly — not touching it."
        echo "   Update the checkout yourself, then re-run, or: git checkout main"
        exit 1
        ;;
    esac

    # --- git credentials ---------------------------------------------------
    # .env is only sourced at step 3 (registry login) — the pull below needs
    # the token NOW, so lift just these two keys early. GIT_TERMINAL_PROMPT=0
    # on every git network call: under cron there is no TTY and git's
    # username prompt is the classic "could not read Username" failure.
    if [ -f .env ]; then
      GHCR_PULL_TOKEN="${GHCR_PULL_TOKEN:-$(sed -n 's/^GHCR_PULL_TOKEN=//p' .env | head -1 | tr -d "\"'")}"
      GHCR_PULL_USER="${GHCR_PULL_USER:-$(sed -n 's/^GHCR_PULL_USER=//p' .env | head -1 | tr -d "\"'")}"
      export GHCR_PULL_TOKEN GHCR_PULL_USER
    fi
    # Try anonymous/ambient credentials first; fall back to the pull token via
    # an env-reading credential helper (the secret never lands on a command
    # line). A token that pulls images fine but 403s here lacks the
    # read:repository scope — say so instead of the misleading generic error.
    local -a git_auth=()
    if ! GIT_TERMINAL_PROMPT=0 git ls-remote -q origin HEAD >/dev/null 2>&1; then
      git_auth=(-c 'credential.helper=!f() { echo "username=${GHCR_PULL_USER:-blakey108}"; echo "password=${GHCR_PULL_TOKEN}"; }; f')
      if [ -z "${GHCR_PULL_TOKEN:-}" ] || ! GIT_TERMINAL_PROMPT=0 git "${git_auth[@]}" ls-remote -q origin HEAD >/dev/null 2>&1; then
        echo "!! Cannot read the git repository (anonymous${GHCR_PULL_TOKEN:+ and GHCR_PULL_TOKEN} rejected)."
        echo "   Updating the checkout needs a GitHub token with read access to the"
        echo "   repository — a packages-only token (read:packages) pulls images"
        echo "   but does NOT work against github.com."
        echo "   Generate one at GitHub → Settings → Developer settings →"
        echo "   Personal access tokens, and set it in .env (GHCR_PULL_TOKEN)."
        exit 1
      fi
    fi

    old_head="$(git rev-parse HEAD)"
    echo "==> Updating the repo checkout..."
    # setup.sh legitimately rewrites the compose network for this host, so a
    # dirty tracked tree is NORMAL here — stash around the pull instead of
    # refusing. Untracked files (backups/, .env) are never touched.
    local stashed=0
    if ! git diff --quiet || ! git diff --cached --quiet; then
      git stash push -q -m "update.sh auto-stash $(date -u +%FT%TZ)"
      stashed=1
    fi
    if ! GIT_TERMINAL_PROMPT=0 git "${git_auth[@]}" pull --ff-only -q; then
      if [ "$stashed" = 1 ]; then git stash pop -q || true; fi
      echo "!! git pull --ff-only failed — the checkout has local commits or has"
      echo "   diverged from its upstream branch. Resolve that manually, then re-run."
      exit 1
    fi
    if [ "$stashed" = 1 ] && ! git stash pop -q; then
      # A failed pop leaves conflict markers in the tree — that would break
      # every later `docker compose` call, so restore a clean upstream tree.
      # The local edits stay parked in the stash (pop keeps it on failure).
      git reset -q --hard HEAD
      echo "!! Your local edits (usually the setup.sh choices in ${COMPOSE_FILE})"
      echo "   conflict with upstream changes to the same lines. The tree is now clean"
      echo "   upstream; your edits are safe in: git stash list  (git stash show -p)"
      echo "   Re-apply the portal ports mapping (if you had enabled it), then re-run."
      exit 1
    fi
    new_head="$(git rev-parse HEAD)"

    if [ "$new_head" != "$old_head" ]; then
      repo_changed=1
      echo "    ${old_head:0:7} -> ${new_head:0:7}:"
      git --no-pager log --oneline "${old_head}..${new_head}" | sed 's/^/      /'
      # If this script itself changed, hand over to the new version (once).
      if ! git diff --quiet "$old_head" "$new_head" -- update.sh; then
        echo "    update.sh itself changed — continuing with the new version."
        UPDATE_SH_REEXEC="$old_head" exec ./update.sh
      fi
    else
      echo "    Already at origin/main (${new_head:0:7})."
    fi
  else
    # Re-exec after self-update: the pull already happened; recover the delta.
    old_head="$UPDATE_SH_REEXEC"
    new_head="$(git rev-parse HEAD)"
    if [ "$new_head" != "$old_head" ]; then repo_changed=1; fi
  fi

  # --- 2. reconcile .env with .env.example ----------------------------------
  # After the checkout refresh (so the .env.example is the just-pulled one)
  # and before .env is sourced below. Runs on every invocation — including
  # no-change and re-exec runs — so an install can never drift behind.
  if [ -f .env ]; then
    echo "==> Checking .env for keys added since install..."
    reconcile_env .env .env.example
    align_image_tag
    offer_logdash
  fi

  # --- 3. pull the image, detect change ------------------------------------
  echo "==> Checking for a newer image..."
  # Same registry-auth handling as deploy.sh: GHCR requires a login to pull
  # private packages; use the .env pull token when configured, else fall back to an
  # interactive login on "unauthorized".
  # shellcheck disable=SC1091
  [ -f .env ] && set -a && . ./.env && set +a
  if [ -n "${GHCR_PULL_TOKEN:-}" ]; then
    echo "$GHCR_PULL_TOKEN" | docker login ghcr.io -u "${GHCR_PULL_USER:-blakey108}" --password-stdin >/dev/null
  fi

  local old_image new_image
  old_image="$(docker image inspect "${REPO}:${IMAGE_TAG:-$IMAGE_TAG_DEFAULT}" --format '{{.Id}}' 2>/dev/null || true)"
  local pull_log
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
  new_image="$(docker image inspect "${REPO}:${IMAGE_TAG:-$IMAGE_TAG_DEFAULT}" --format '{{.Id}}' 2>/dev/null || true)"

  # "Changed" covers both a fresh pull AND a running container started from
  # an older image than the :latest we already had.
  local running_image image_changed=0
  running_image="$(docker inspect "$CONTAINER" --format '{{.Image}}' 2>/dev/null || true)"
  if [ -n "$new_image" ] && { [ "$new_image" != "$old_image" ] || [ "$running_image" != "$new_image" ]; }; then
    image_changed=1
  fi

  # --- 4. deploy only when something changed --------------------------------
  local compose_changed=0
  if [ "$repo_changed" = 1 ] && ! git diff --quiet "$old_head" "$new_head" -- "$COMPOSE_FILE"; then
    compose_changed=1
  fi

  if [ "$image_changed" = 0 ] && [ "$compose_changed" = 0 ]; then
    echo "==> Already up to date — nothing to restart."
    if [ "$repo_changed" = 1 ]; then
      echo "    (Checkout updated, but neither the image nor ${COMPOSE_FILE} changed.)"
    fi
    exit 0
  fi

  echo "==> Changes found ($([ "$image_changed" = 1 ] && printf 'image')$([ "$image_changed" = 1 ] && [ "$compose_changed" = 1 ] && printf ' + ')$([ "$compose_changed" = 1 ] && printf 'compose')) — deploying via ./deploy.sh"
  echo "    Target version: $(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -1)"
  if [ "$compose_changed" = 1 ]; then
    echo "    Note: ${COMPOSE_FILE} changed. If the restart complains that the"
    echo "    network needs to be recreated, run:  docker compose down && docker compose up -d"
  fi
  ./deploy.sh
}

main "$@"
