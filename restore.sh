#!/usr/bin/env bash
# Restore the portal Postgres database from a backup.sh dump.
#
# DESTRUCTIVE: this overwrites the current database — everything written since
# the chosen dump is lost. Stop the app first so nothing writes mid-restore:
#   docker compose stop portal && ./restore.sh && docker compose start portal
#
# Usage:
#   ./restore.sh                          # restore the newest dump in $BACKUP_PATH
#   ./restore.sh backups/portal-....sql.gz  # restore a specific dump
set -euo pipefail
cd "$(dirname "$0")"

DB=${DB_CONTAINER:-unifi-captive-portal-db}
# shellcheck disable=SC1091
[ -f .env ] && set -a && . ./.env && set +a
BACKUP_DIR=${BACKUP_PATH:-./backups}

dump=${1:-}
if [ -z "$dump" ]; then
  dump=$(ls -1t "$BACKUP_DIR"/portal-*.sql.gz 2>/dev/null | head -1 || true)
  [ -z "$dump" ] && { echo "!! No dumps found in $BACKUP_DIR"; exit 1; }
  echo "==> Newest dump: $dump"
fi
[ -f "$dump" ] || { echo "!! Not found: $dump"; exit 1; }
docker inspect "$DB" >/dev/null 2>&1 || { echo "!! DB container '$DB' is not running"; exit 1; }

echo ""
echo "    Restore '$dump'"
echo "    into container '$DB', database 'portal'."
echo "    This OVERWRITES the current database — all data since this dump is lost."
if docker inspect unifi-captive-portal >/dev/null 2>&1 \
   && [ "$(docker inspect -f '{{.State.Running}}' unifi-captive-portal 2>/dev/null)" = "true" ]; then
  echo "    !! The app container is still RUNNING — stop it first to avoid a"
  echo "       half-restored DB:  docker compose stop portal"
fi
read -rp "    Type 'restore' to proceed: " ans
[ "$ans" = "restore" ] || { echo "aborted"; exit 1; }

# Drop and recreate the schema so a plain-format dump (no DROPs) applies onto a
# clean slate rather than colliding with existing objects; ON_ERROR_STOP so a
# failure aborts loudly instead of leaving a half-applied DB.
echo "==> Resetting schema..."
docker exec -i "$DB" psql -v ON_ERROR_STOP=1 -U portal -d portal \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

echo "==> Restoring..."
gunzip -c "$dump" | docker exec -i "$DB" psql -v ON_ERROR_STOP=1 -U portal -d portal >/dev/null

echo "==> Done. Start the app if you stopped it:  docker compose start portal"
