#!/usr/bin/env bash
# Nightly Postgres backup + disk watch for the captive portal.
# Dumps are written INSIDE the db container to /backups — mount that to a
# second location in docker-compose via BACKUP_PATH (defaults to ./backups).
# Enable with one cron line on the host (cron emails any output to MAILTO):
#   0 3 * * *  MAILTO=you@example.com  /home/ladm/portal/backup.sh
set -euo pipefail

DB=${DB_CONTAINER:-unifi-captive-portal-db}
KEEP_DAYS=${KEEP_DAYS:-14}
DISK_WARN_PCT=${DISK_WARN_PCT:-85}

# Dump to a .tmp then rename, with pipefail, so a failed/partial pg_dump can
# never leave a truncated .sql.gz that rotation keeps and restore later trusts.
docker exec "$DB" sh -c "
  set -o pipefail
  f=/backups/portal-\$(date +%F-%H%M).sql.gz
  if pg_dump -U portal portal | gzip > \"\$f.tmp\"; then
    mv \"\$f.tmp\" \"\$f\"
  else
    rm -f \"\$f.tmp\"
    echo 'ERROR: pg_dump failed — no backup written' >&2
    exit 1
  fi
"
docker exec "$DB" sh -c "find /backups -name 'portal-*.sql.gz' -mtime +$KEEP_DAYS -delete"

# Only print when over threshold — cron then mails the warning.
used=$(df --output=pcent / | tr -dc '0-9')
if [ "$used" -ge "$DISK_WARN_PCT" ]; then
  echo "WARNING: disk at ${used}% on $(hostname) — prune images/build cache (deploy.sh does this on deploy)."
fi
