#!/usr/bin/env bash
# Pin this host to the NIGHTLY line and bring it current — kept as the
# historical entry point (cron jobs and habit); the general mover is
# ./switch-branch.sh, which this delegates to with confirmations skipped
# (running nightly.sh IS the deliberate choice, same contract as before).
# It only redeploys when something actually changed (update.sh decides), so
# a no-change run costs nothing. Never point a host you care about at
# nightly — it is the ungated fast-iteration line (no tests, no scanners).
#
# Usage:  ./nightly.sh   (from the repo checkout, same folder as update.sh)
set -euo pipefail
cd "$(dirname "$0")"
exec ./switch-branch.sh -y nightly
