# Operations Runbook

Day-2 operations for the deployed portal. Pairs with **ARCHITECTURE.md**
(what's in scope and why) and **GO-LIVE.md** (pre-cutover checklist).

## Routine

| Task | Command | Notes |
|---|---|---|
| Update / redeploy | `./install.sh update` | Pull `:latest`, restart, health-check, verify migrations, prune. Cron-safe. |
| Follow a release line | `./install.sh channel <line>` | Pin `IMAGE_TAG` for `main` / `develop` / `nightly`, then update. |
| Health + migration check | `./install.sh verify` | Read-only; exits non-zero if anything's off. |
| Apply migrations on demand | `./install.sh migrate` | `prisma migrate deploy` + verify. |
| Nightly backup | `./install.sh backup` (cron) | `pg_dump` → `/backups`, 14-day rotation. |
| Restore | `./install.sh restore [dump]` | **Destructive**; stop the app first. |

Reference deploy host crontab (root; `MAILTO` as a variable line so cron
mails the output):

(`/opt/unifi-portal` is your install directory — `install.sh` locates itself, so it can live anywhere.)

```cron
MAILTO=ops@example.com
0 3 * * *  /opt/unifi-portal/install.sh backup
30 4 * * * /opt/unifi-portal/install.sh update
```

The daily `update` line moves the host to the newest `:latest` image, restarts,
health-checks, verifies migrations, and prunes. On a host reboot the containers
come back on their own via Compose's restart policy; the next `update` run then
brings them to the newest image. See README "Backups & health" →
*Updates* for details and the CI-shares-the-daemon retag quirk.

## Disaster recovery, RTO / RPO

- **RPO (max data loss): ≤ 24 h.** `install.sh backup` runs nightly (`pg_dump`, gzip,
  atomic `.tmp`-then-rename, 14-day rotation). To tighten RPO, run the cron
  more often and/or point `BACKUP_PATH` at a second disk/NAS.
- **RTO (time to restore): ~minutes.** Recovery is `install.sh restore` (resets schema,
  applies the dump with `ON_ERROR_STOP`) then `docker compose up -d`. Migrations
  run on container boot.

**Full-host recovery procedure:**
1. Reinstall Docker + clone the repo; run `./install.sh setup` (it creates `.env` and
   asks whether to run the bundled Traefik).
2. **Restore `ADMIN_SECRET`** into `.env` from your secret store. This is
   critical: secrets at rest (UniFi/SMTP/Cloudflare/SSH secrets, TOTP) are
   AES-GCM-encrypted with a key derived from it, a *different* `ADMIN_SECRET`
   makes every stored secret unrecoverable (they read as "not set" and must be
   re-entered). Also invalidates existing sessions.
3. Restore the newest DB dump: `./install.sh restore backups/portal-<newest>.sql.gz`.
4. Restore the `portal-uploads` volume (logos/backgrounds) if used.
5. `docker compose up -d`; confirm `GET /api/health` reports the expected
   version and the admin panel loads.

**Back up all three:** the DB dumps, the `ADMIN_SECRET`, and the uploads
volume. The DB alone is not a complete recovery.

## Rate-limit coverage

In-process token buckets (`src/lib/rateLimit.ts`); correct for a single
container. Covered entry points:

| Endpoint | Limit | Rationale |
|---|---|---|
| `admin/login` | 20 / 15 min / IP | 2FA legitimately double-hits; shared NAT |
| `portal/login` | per `src/lib/rateLimit.ts` | guest self-service login |
| `portal/verify/{confirm,grace,resend}` | per module | email-link abuse |

Not separately rate-limited (bounded by other means): guest
authorize/registration (per-phone device cap + advisory lock), admin mutations
(auth-gated + audited), proxy-resource changes (auth-gated + audited). If the portal is ever
exposed beyond the LAN, add a proxy-level rate limit as the outer layer.

## CI

Two GitHub Actions run the pipeline (no external secrets):

- `ci.yml` — typecheck, unit tests, and a fresh-DB migration check, on pushes
  and PRs to `develop`/`main`.
- image builds — `publish-image.yml` (`main` → `:latest`), `develop-build.yml`
  (`develop` → `:develop`), `nightly-build.yml` (`nightly` → `:nightly`).

If you want merges gated, add branch-protection rules requiring the `CI` check
on `main`/`develop` (Settings → Branches). `nightly` is intentionally ungated.

## Health & monitoring

- `GET /api/health` → `{ ok, version, commit, builtAt }`. Docker healthcheck
  hits it; `docker ps` shows `healthy`/`unhealthy`.
- `GET /api/version` → `{ running, latest, upToDate }`, whether the deploy is
  on the newest release, checkable from anywhere the portal is reachable
  (needs the update check enabled in Settings → Monitoring — plus a
  read-only GitHub token if the repo is private; answers are cached hourly,
  safe for external monitors).
- Plain Compose does **not** auto-restart an *unhealthy* (hung) container; pair with host monitoring or an autoheal sidecar if you need that.
- **Disk**: CI leaves ~1.4 GB per image; `install.sh update`/`install.sh update` prune, but a
  full disk crash-loops the container via a failed boot migration. Watch it.

## Monitoring resilience

Every alert rule reads one UniFi controller snapshot per cycle; when the
controller itself is unreachable (network path down, or the cookie login
locked out), the device-derived rules deliberately freeze rather than flap
everything to "resolved" — so without the watchdog below, a controller
outage produced no alert at all.

- **`controller_down` alert** (Settings → Monitoring, on by default): opens
  after `alertControllerDownCycles` (default 3) consecutive failed poll
  cycles, over email/webhook (neither depends on the controller). An open
  alert row survives a process restart mid-outage — it refreshes instead of
  re-waiting the threshold. Resolves itself on the first successful poll.
  Manual "Check now" runs on the Alerts page count toward the streak.

- **SNMP fallback** (Settings → Monitoring, off by default): once a
  `controller_down` alert is actually open (not on a single blip), and SNMP
  fallback is enabled with valid SNMPv3 credentials, the portal sweeps the
  last-known adopted device list (`SnmpTarget`, refreshed every healthy
  cycle) for basic reachability (`sysUpTime` GET). Unreachable devices open a
  distinct `snmp_offline` alert — kept separate from the controller-derived
  `offline` type so recovery is unambiguous and the frozen controller alerts
  are never touched. The dashboard shows an amber banner naming the SNMP
  fallback summary (e.g. "212/267 devices answering") while the outage lasts.
  v3 authPriv only, by design — no v1/v2c community-string support on a
  network this security-sensitive.

  A daily canary (while the controller is healthy) samples one gateway, one
  AP and one switch to catch broken credentials before an actual outage
  needs them — it only fires if every sampled device is unreachable, so one
  unrelated device being down doesn't trip it.

**Setup**: enable SNMPv3 on the controller (Settings → System → SNMP), save
matching credentials in the portal's Settings → Monitoring, then click
"Test SNMP now" to confirm reachability before trusting the fallback.

**Degraded-mode drill** (run once after setup, and periodically): during a
maintenance window, block the portal's path to the controller (or point
`unifiUrl` at a dead port) and confirm: (1) `controller_down` opens within
`alertControllerDownCycles` polls and the notification arrives; (2) the
dashboard banner shows the SNMP summary; (3) powering off one lab device
opens a matching `snmp_offline` alert; (4) restoring the controller path
resolves everything through the normal diff on the next poll.

**Config-health check**: the Network Review tab flags SNMP v1/v2c
(community-string) left enabled on the controller, and flags the portal's
SNMP fallback being on while the controller's own SNMP section looks off
(nothing to poll).

**Diagnosing a single unreachable device**: the floating device window shows
a "Config out of date" warning when the controller's `cfgversion` and the
device's last-acknowledged `known_cfgversion` differ — the device hasn't
absorbed the latest site-wide settings yet (SNMP included), and needs a
reprovision from the controller. Unverified field pair on this controller
version; degrades to silence if either is absent, so it costs nothing on a
controller where they don't exist. If the warning is absent and SNMP still
times out for one device on a subnet where others answer, suspect a
firewall/VLAN policy blocking UDP/161 to that specific network instead —
the "Test SNMP" button in any device's window probes that one device
directly (unlike the fixed 3-device sample on Settings → Monitoring), so
you can test a second device on the same subnet to tell "this one device"
from "this whole VLAN" apart.

**Honest scope**: only devices reporting a private/LAN IP are polled. A
gateway's `stat/device` IP is frequently its WAN (public) address —
confirmed live 2026-07-15 on this deployment, where the gateway's reported
IP timed out while a switch on a private IP answered with the same
credentials — and polling a public IP from the LAN side means hairpinning
out over the internet to reach yourself, which fails on most routers
regardless of whether SNMP is even listening there. So the gateway is
commonly excluded from the fallback; APs and switches on private addresses
are the coverage that matters.

## Guest/admin split (optional, Phase 17 A-lite)

By default one container serves both the guest/captive side and the admin side.
`PORTAL_MODE` lets you run two containers off the **same image** so a guest-side
problem can't touch the admin process, and the admin surface simply doesn't
exist on the guest side.

- `PORTAL_MODE=guest` — serves only the captive/guest side. `/admin` and
  `/api/admin` return 404 here (enforced in the middleware and `requireAdmin`),
  and this process runs **no** background schedulers.
- `PORTAL_MODE=admin` — serves only the admin side; guest pages 404 here. This
  process owns the schedulers.
- unset — "all": one process serves everything (today's default, unchanged).

Both containers need `DATABASE_URL`, `ADMIN_SECRET`, and the UniFi creds (the
guest authorize path uses `unifi.ts`); set a separate `GUEST_SESSION_SECRET` so
session material isn't shared. Both read the same `.env`.

**Prerequisite: a separate admin hostname.** Set the Admin GUI URL to its own
hostname (Settings → URLs), distinct from the guest/captive host. A blank,
bare-IP, or guest-shared admin URL gets no Traefik router under a split, which
locks the admin GUI out on every host — the container warns about this at boot.

**Enabling it (bundled Traefik).** Two `.env` edits — set **both** or you land
in a half-configured state (the container warns loudly at boot about either
half alone):

1. `PORTAL_MODE="guest"` — the existing `portal` service becomes the
   guest-only container.
2. Add `split` to `COMPOSE_PROFILES` so it reads `COMPOSE_PROFILES="traefik,split"`
   — compose then also runs the `portal-admin` service: the same image with
   `PORTAL_MODE=admin` pinned, container `unifi-captive-portal-admin`.
3. `docker compose up -d` (or `./install.sh update`, which pulls, restarts and
   health-checks both containers when the profile is active).

Routing follows automatically: with the split profile active, `/api/traefik/config`
adds a `portal-admin` upstream (`http://portal-admin:3000`) and points the
admin host's router at it; the captive/guest hosts and the bare-IP catch-all
stay on the guest container. The proxy **control plane moves with it**: the
bundled Traefik's static config is rewritten to poll the admin container, and a
guest-role process refuses to serve `/api/traefik/config` and never writes
`./traefik` (Traefik keeps its last-good config while the admin container
restarts). Because the split key is the compose profile, a container with
`PORTAL_MODE` set but the profile missing does **not** point Traefik at a
non-existent `portal-admin` — it self-serves and warns.

Behind an **external** Traefik the compose name doesn't resolve, so
`ADMIN_UPSTREAM_URL` is **required** — set it to wherever your proxy reaches the
admin container, and repoint your provider endpoint there (the snippet on
Settings → URLs updates itself once the split is live). The bundled
`portal-admin` service publishes no host port; expose it yourself (a `ports:`
mapping or a shared network) for an external proxy to reach it.

Notes for a split deployment:

- Both containers run the boot migration; Prisma serialises it with an
  advisory lock, so concurrent starts are safe.
- **Network isolation:** `portal-admin` sits on its own `admin-net`, shared
  only with Traefik — the guest container is on `web` and cannot reach the
  admin process directly, only through Traefik's host routing.
- Only the admin process writes the bundled Traefik's static config, serves
  the dynamic config Traefik polls, and runs the schedulers.
- The admin container pins `SCHEDULERS=""` over the shared `.env`, so it owns
  the schedulers even if `.env` sets `SCHEDULERS=off` — do **not** set that key
  for a split.
- Settings changes made in the admin GUI reach the guest container within
  ~15 s (the per-process settings cache TTL).
- **Boot ordering:** Traefik `depends_on` the guest container, not
  `portal-admin`. On a cold reboot Traefik may poll `portal-admin` before it is
  ready; it retries every 5 s, so routes appear within seconds of the admin
  container becoming healthy (a brief window with no routes, not an outage).
- **To back out:** stop the admin container first, then restore the single
  container: `docker compose --profile split down`, remove `split` from
  `COMPOSE_PROFILES`, blank `PORTAL_MODE`, clear `ADMIN_UPSTREAM_URL` if set,
  then `docker compose up -d`. (A profile-disabled service is not treated as an
  orphan, so `--remove-orphans` alone leaves `portal-admin` running.)

Verify on a live host after enabling — the admin host must serve `/admin`, the
guest host must 404 it, and `docker ps` should show both portal containers
healthy. This topology can't be exercised in CI.

**Settings → URLs → System Health** (bottom of the page) then shows this
continuously: per-container Docker state, published by the traefik-ops sidecar
into the shared `./traefik` mount as `docker-status.json` every ~10 s (the
portal itself never holds the docker socket), plus live separation checks —
this page served by the admin-only process, no network path from the admin
container to the guest container (the isolation is a missing shared network,
so it holds in both directions), the guest side answering through Traefik on
the same build, and the admin surface blocked on the guest host. The
network-path check discards loopback and own-address DNS answers before
probing: Docker forwards unknown names to the host's resolver, so a host
machine itself named `portal` makes that name resolve to its `/etc/hosts`
self-alias (`127.0.1.1`) inside every container — a bare probe would hit the
admin container itself and false-alarm. Only an HTTP answer from a foreign
address fails the check. The panel is
monitoring, not a security proof: the guest container can write to the same
mount (see the boundary note below), so treat an unexpected green as a prompt
to check `docker ps`, not as attestation. A sidecar started before this
feature exists needs one `docker compose restart traefik-ops` to begin
publishing — `install.sh update` now bounces it on every deploy.

**Security boundary — what the split does and doesn't isolate.** The admin
HTML, `/api/admin`, and the guest APIs (`/api/portal`, `/api/sponsor`) all 404
on the guest process, and `admin-net` keeps the guest container off the admin
network, so the app-level and network-level admin surface is unreachable from a
guest-side compromise. It is **not** byte-level isolation: both processes serve
`/_next/static` chunks (no secrets), and the guest container still bind-mounts
`./traefik` read-write, so a *compromised guest container* (not the untampered
process) could still rewrite the static config or read `cf-token`. To close
that too, drop or `:ro` the `./traefik` mount on the guest service via a compose
override, or use the A-full two-build restructure (docs/ROADMAP.md Phase 17).

## Traefik log dashboard (optional)

Real-time analytics over the bundled Traefik's access log — GeoIP maps,
status-code breakdowns, per-service metrics — via
[hhftechnology/traefik-log-dashboard](https://github.com/hhftechnology/traefik-log-dashboard)
(two third-party containers: a Go agent tailing the log and a web UI).
Opt-in, off by default, requires the bundled Traefik.

**Sign-in is the portal's own admin account** — no separate credentials.
Every request to the dashboard host passes a Traefik `forwardAuth`
middleware pointing back at the portal: a valid admin session answers 200,
anything else is redirected through the admin host, which runs the normal
`/admin/login` (2FA, per-account lockouts) and hands the session back to
the dashboard's hostname via a 60-second signed handoff
(`/api/logdash-auth` + `/api/logdash-auth/start`). Password changes and
account expiry revoke dashboard access on the next request, exactly like
the admin panel.

**Enable the easy way**: `./scripts/enable-logdash.sh` asks for the
hostname, generates the token, patches `.env`, and brings the stack up.
Interactive `install.sh update` runs offer to run it while the feature is
unconfigured (answer `never` to silence the offer; cron runs never ask).

**Or by hand** (all in `.env`, then `docker compose up -d` — recreating the
portal makes it rewrite `traefik.yml` with the access-log block):

1. Add `logdash` to `COMPOSE_PROFILES` (e.g. `"traefik,logdash"`).
2. `LOGDASH_TOKEN` — shared agent↔UI token: `openssl rand -hex 24`.
3. `LOGDASH_HOST` — the dashboard's own hostname (DNS to this host, like the
   portal's other domains). It appears as a "Traefik log dashboard" link at
   the bottom of the admin sidebar.

**How it hangs together.** With the profile on, the portal writes a JSON
`accessLog` into the bundled static config (file on the `traefik-logs`
volume) and emits a `portal-logdash` router in the dynamic config:
HTTPS-only (Cloudflare cert like every other host) behind the forwardAuth
middleware above — the dashboard UI has no login of its own, so the gate is
mandatory, and a blank `LOGDASH_HOST` means the router is never emitted.
The stack sits on its own `logdash-net`; neither the guest nor the
admin container can reach it. The traefik-ops sidecar truncates the access
log past `LOGDASH_LOG_MAX_MB` (default 256) since Traefik never rotates its
own logs. Both dashboard containers show up in the System Health panel,
which also live-checks the sign-in gate (a session-less probe must bounce
to the admin host, never answer 200).

**Caveats.** The images are third-party (`hhftechnology/*`, default
`:latest` — pin with `LOGDASH_IMAGE_TAG`); they are not covered by this
repo's image scanning, so treat them like any other LAN service you host.
GeoIP lookups fall back to an external HTTP provider (`ipwho.is`) unless you
mount a local MaxMind DB — that means the agent sends visitor IPs to that
service; point it at a local MMDB if that matters for your privacy posture.

**Disable**: remove `logdash` from `COMPOSE_PROFILES`, run
`docker compose --profile logdash down`, then `docker compose up -d` and
restart the portal once (the access log and router disappear with the
profile).

## Known operational limitations

- Single container = no rolling deploy; `install.sh update` restart is a brief blip.
- The alert monitor, retention, and metric samplers are in-process timers
  (single-run guarded), not a separate scheduler, fine for one host.
- See ARCHITECTURE.md for the full in-scope/out-of-scope matrix.
