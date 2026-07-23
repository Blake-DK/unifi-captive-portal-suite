#!/usr/bin/env bash
# Move this host between the release lines (main / develop / nightly): switch
# the repo checkout to the chosen branch, pin the matching IMAGE_TAG in .env,
# then hand off to ./update.sh, which pulls the branch, reconciles .env, pulls
# the image and redeploys the containers only when something actually changed.
#
# Run with no argument for an interactive picker, or name the branch directly:
#
#   ./switch-branch.sh            # asks which branch to move to
#   ./switch-branch.sh develop    # non-interactive
#   ./switch-branch.sh -y nightly # -y skips the confirmations (scripted use)
#
# Moving DOWN the lines (nightly -> develop -> main) does not undo database
# migrations: the older app runs against the newer schema. Additive migrations
# are usually harmless, but take a backup first (./backup.sh) — the script
# asks before descending.
set -euo pipefail
cd "$(dirname "$0")"

command -v git >/dev/null || { echo "!! git is not installed"; exit 1; }

usage() { echo "Usage: ./switch-branch.sh [-y] [main|develop|nightly]"; }

# Line order for the downgrade warning: higher rank = further from stable.
rank() { case "$1" in main) echo 0;; develop) echo 1;; nightly) echo 2;; *) echo 99;; esac; }
tag_for() { case "$1" in main) echo latest;; *) echo "$1";; esac; }

confirm() {
  [ "$ASSUME_YES" = 1 ] && return 0
  if [ ! -t 0 ]; then
    echo "   (non-interactive run — re-run from a terminal, or pass -y to confirm)"
    exit 1
  fi
  local a
  read -r -p "$1 [y/N] " a
  case "$a" in y|Y) ;; *) echo "Aborted — nothing changed."; exit 0;; esac
}

ASSUME_YES=0
target=""
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1;;
    -h|--help) usage; exit 0;;
    *) target="$arg";;
  esac
done

current="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"

if [ -z "$target" ]; then
  if [ ! -t 0 ]; then
    echo "!! No terminal and no branch argument."
    usage
    exit 1
  fi
  echo "Which release line should this host follow? (currently on: ${current})"
  echo "  1) main     — stable releases        (:latest image, fully gated)"
  echo "  2) develop  — integration builds     (:develop, CI + security scanners)"
  echo "  3) nightly  — ungated fast iteration (:nightly, NO tests or scanners)"
  read -r -p "Branch [1-3 or name; Enter aborts]: " target
fi
case "$target" in
  1) target=main;; 2) target=develop;; 3) target=nightly;;
esac
case "$target" in
  main|develop|nightly) ;;
  "") echo "Aborted — nothing changed."; exit 0;;
  *) echo "!! Unknown branch '${target}' — pick main, develop or nightly."; exit 1;;
esac

if [ "$target" = nightly ] && [ "$current" != nightly ]; then
  echo "!! nightly is the UNGATED fast-iteration line: direct pushes, no tests,"
  echo "   no scanners. Never point a host you care about at it."
  confirm "   Follow nightly anyway?"
fi
if [ "$(rank "$target")" -lt "$(rank "$current")" ]; then
  echo "!! Moving from ${current} to ${target} runs OLDER code on the database"
  echo "   schema the newer line already migrated — migrations are not undone."
  echo "   Additive changes are usually harmless, but take a backup first"
  echo "   (./backup.sh) if you haven't."
  confirm "   Continue to ${target}?"
fi

# Same env-reading credential fallback as update.sh: anonymous first, then
# the .env pull token (which must be a GitHub token with repo read access).
if [ -f .env ]; then
  GITEA_PULL_TOKEN="${GITEA_PULL_TOKEN:-$(sed -n 's/^GITEA_PULL_TOKEN=//p' .env | head -1 | tr -d "\"'")}"
  GITEA_PULL_USER="${GITEA_PULL_USER:-$(sed -n 's/^GITEA_PULL_USER=//p' .env | head -1 | tr -d "\"'")}"
  export GITEA_PULL_TOKEN GITEA_PULL_USER
fi
git_auth=()
if ! GIT_TERMINAL_PROMPT=0 git ls-remote -q origin HEAD >/dev/null 2>&1; then
  git_auth=(-c 'credential.helper=!f() { echo "username=${GITEA_PULL_USER:-token}"; echo "password=${GITEA_PULL_TOKEN}"; }; f')
  if [ -z "${GITEA_PULL_TOKEN:-}" ] || ! GIT_TERMINAL_PROMPT=0 git "${git_auth[@]}" ls-remote -q origin HEAD >/dev/null 2>&1; then
    echo "!! Cannot read the git repository — GITEA_PULL_TOKEN in .env must hold"
    echo "   a GitHub token with repo read access (see update.sh's message)."
    exit 1
  fi
fi

if [ "$current" != "$target" ]; then
  echo "==> Switching checkout from '${current}' to ${target}..."
  GIT_TERMINAL_PROMPT=0 git "${git_auth[@]}" fetch -q origin "$target"
  # setup.sh legitimately edits tracked files (compose network) — stash around
  # the branch switch exactly like update.sh does around its pull.
  stashed=0
  if ! git diff --quiet || ! git diff --cached --quiet; then
    git stash push -q -m "switch-branch.sh auto-stash $(date -u +%FT%TZ)"
    stashed=1
  fi
  git checkout -q "$target"
  if [ "$stashed" = 1 ] && ! git stash pop -q; then
    git reset -q --hard HEAD
    echo "!! Your local edits conflict with the ${target} branch; they are parked in"
    echo "   the stash (git stash list). Re-apply what you need, then re-run."
    exit 1
  fi
fi

# Pin the image line explicitly — update.sh only fills a BLANK IMAGE_TAG, and
# this host is deliberately moving lines now.
tag="$(tag_for "$target")"
if [ -f .env ]; then
  if grep -q '^IMAGE_TAG=' .env; then
    grep -q "^IMAGE_TAG=\"${tag}\"" .env || sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=\"${tag}\"/" .env
  else
    printf '\n# Image line pinned by switch-branch.sh (this host follows %s).\nIMAGE_TAG="%s"\n' "$target" "$tag" >> .env
  fi
  echo "==> IMAGE_TAG pinned to \"${tag}\"."
fi

exec ./update.sh
