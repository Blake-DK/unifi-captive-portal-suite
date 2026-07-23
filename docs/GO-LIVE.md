# Production Go-Live Runbook

Pre-flight checklist, cutover steps, verification, and day-2 operations for
deploying the UniFi captive portal into the production network. Companion to
[STATUS.md](./STATUS.md) (current state) and [README.md](../README.md) (setup).

**Last updated:** 2026-07-04 · **Release:** v1.0.0 (`GET /api/health` → `version`)

---

## 1. Readiness scorecard

| # | Item | Status |
|---|------|--------|
| 1 | Automated DB backups | ✅ nightly `pg_dump` cron → `/backups` mount |
| 2 | Secrets encrypted at rest | ✅ AES-256-GCM (key from `ADMIN_SECRET`) |
| 3 | Container healthcheck | ✅ `/api/health` on the `portal` service |
| 4 | Finite retention set | ✅ default 90d anonymise / audit 365d (+ per-location) |
| 5 | Disk watch | ✅ folded into `backup.sh` (warns ≥ 85%) |

Accepted, non-blocking (see §6): single-container (no HA), no app-level error
monitoring, guest login is phone + last name (unverified), admin self-grant of
the traffic toggle.

---

## 2. Pre-cutover checklist

Run through this before pointing production SSIDs at the portal.

- [ ] **`.env` reviewed**: strong `ADMIN_SECRET` (≥16 chars) and
  `POSTGRES_PASSWORD`, both **backed up somewhere safe** (losing `ADMIN_SECRET`
  logs everyone out *and* makes encrypted secrets unreadable).
- [ ] **`BACKUP_PATH`** set to a **second physical location** (another disk /
  NAS mount), not the app disk, then `docker compose up -d db`.
- [ ] **Backup cron installed** and the cron daemon is running
  (`crontab -l`, `pgrep -x cron`). Do a manual `./backup.sh` and confirm a
  `.gz` lands in `BACKUP_PATH`.
- [ ] **Retention** confirmed per policy (Settings → Locations). Remember
  anonymisation is **destructive** and starts on the next hourly job.
- [ ] **Secrets encrypted**: `GET /api/health` up; DB secret columns start
  with `enc:v1:` (spot-check; never print the values).
- [ ] **UniFi controller** reachable; Settings → UniFi → Test Connection passes.
- [ ] **Reverse proxy** live: Settings → URLs → Reverse Proxy shows Traefik
  polling; guest hosts 403 `/admin`; admin host serves HTTPS with a valid
  certificate.
- [ ] **Email** (if used), Settings → Email → send test.
- [ ] **Admin 2FA + recovery codes**: every admin has 2FA on and has
  **saved their recovery codes** (My Account → Regenerate if never shown).
- [ ] **Require HTTPS for session cookies** (Settings → URLs → Session
  Security) reviewed for the HTTPS admin/guest hosts (note the captive host
  is HTTP by design). Confirm the admin/guest URLs above are actually HTTPS
  *before* enabling this, see the escape hatch in §5 if it's misconfigured.
- [ ] **Disk headroom**: `df -h /` has comfortable free space before launch.

---

## 3. Cutover

1. Confirm `main` is deployed and healthy:
   ```bash
   ./deploy.sh                 # pull :latest → restart → health-check → prune
   curl -s http://<bridge-ip>/api/health -H 'Host: portal.example.com'
   # → {"ok":true,"version":"1.0.0","commit":"<tip-of-main>",...}
   ```
2. In UniFi, set the guest SSID(s) **External Portal Server** URL to the portal
   (Settings → UniFi shows the exact URL), or use one-click Hotspot Apply.
3. Add the walled-garden / pre-auth entries the guest flow needs (see README
   §"Pre-authorisation access").
4. Join the guest SSID on a test device and complete a real registration end to
   end (redirect → register → authorised → self-service).

---

## 4. Post-deploy verification

- **Health:** `GET /api/health` `commit` == tip of `main`; both containers
  `docker ps` → `healthy`.
- **Guest flow:** a real device registers and gets online; it appears under
  Sessions and Users.
- **Network:** Dashboard live row shows WAN online + real client/device counts;
  Map renders the topology.
- **Turn on** (optional, GUI): Settings → Monitoring → Network Alerts and Metric
  history, with an email/webhook for alerts.
- **Logs:** `docker logs unifi-captive-portal`, no repeating errors; you should
  see the schedulers start.

---

## 5. Day-2 operations

**Deploy a new build**: after CI builds a merge to `main`:
```bash
./deploy.sh        # pull :latest, restart, health-check, prune old images
```

**Backups**
- Nightly via cron; on demand: `./backup.sh`.
- **Restore:**
  ```bash
  gunzip -c "$BACKUP_PATH/portal-YYYY-MM-DD-HHMM.sql.gz" \
    | docker exec -i unifi-captive-portal-db psql -U portal portal
  ```

**Disk full (the one that bites)**: a full `/` fails the on-boot migration and
crash-loops the container. `deploy.sh` prunes on every deploy; if it still fills:
```bash
docker builder prune -af
# remove superseded per-commit image tags, keep latest + running
# if a migration half-applied:
docker run --rm --network portal_db-net -e DATABASE_URL=... node:24-alpine \
  sh -c "npx prisma migrate resolve --rolled-back <name> && npx prisma migrate deploy"
docker compose up -d portal
```

**Rollback**: `deploy.sh` keeps the newest few per-commit image tags. Re-point
the `portal` service image tag to a previous `:<sha>` and `docker compose up -d
portal`. (A schema migration is forward-only, restore from backup if a bad
migration shipped.)

**Locked out after enabling "Require HTTPS for session cookies"**, if this
gets turned on for a deployment not actually served over HTTPS, every login
(admin and guest) breaks instantly, and there's no in-app recovery path: the
blank-username setup login is normally unavailable once real admin accounts
exist, and even when it is available it goes through the same check. Fix
directly in the database:
```bash
docker compose exec db psql -U portal portal \
  -c 'UPDATE "SystemSettings" SET "cookieSecure" = false;'
```

**Rotate a leaked secret**: re-enter it in Settings (it re-encrypts on save).
Do **not** change `ADMIN_SECRET` casually: it invalidates all sessions and makes
every stored secret unreadable (you'd re-enter them all).

**Health/monitoring**: `docker ps` shows healthy/unhealthy; plain Compose does
**not** auto-restart an unhealthy container, pair with host monitoring if you
want auto-restart on hang.

---

## 6. Accepted risks & near-term follow-ups

- **Single container / no HA**: one box, single in-process schedulers. Fine for
  capacity; it is a single point of failure.
- **No app-level error monitoring** (Sentry/OTel), errors live in `docker logs`.
- **Guest login is phone + last name** (unverified); email gates *access*, not
  identity. SMS OTP is the next hardening step.
- **Admin self-grant**: any full admin can grant themselves the traffic toggle
  or promote others (audited; no hard separation of duties).
- **Backups cover the DB, not uploads**: the `portal-uploads` volume (logos,
  images) isn't in `backup.sh`; add it if those matter.

None of these block go-live; track them post-launch.
