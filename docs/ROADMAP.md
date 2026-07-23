# Portal Roadmap

How this portal compares to commercial guest-WiFi products, and a phased plan
for closing the gaps that matter here - with a focus on deeper UniFi
integration (usage history, traffic visibility).

## Feature inventory (as of 2026-07-06)

One line per capability, grouped by job. The comparison sections below
measure this list against commercial tools.

| Category | Shipped |
|---|---|
| **Guest experience** | Branded captive registration with location tiles, building/room capture (room required for hotel locations), terms + privacy notice, self-service device list (live status, usage sparkline, ticking expiry countdown, renew/remove/label), magic-link handoff, light/dark/system theme |
| **Identity & verification** | Email verification (provisional window → branded link → full access, grace + resend), vouchers as verification stand-in, phone+last-name self-service login |
| **Access plans** | Site defaults + per-location tiered plans (duration/bandwidth/quota/device cap) + event mode + vouchers; precedence voucher > event > location > site |
| **Network visibility** | Live topology map with issue badges + flapping-link overlay, unified issues board (`/admin/issues`), device + site health (`/admin/status`), all-clients list with rogue-extender flagging + filters (`/admin/clients`), dedicated range-extender tool (`/admin/extenders`), click-through **draggable client-detail windows** (live state + registration + 30-day session history), AP stats tab (`/admin/aps`), switch-port inventory showing clients *and* UniFi devices per port (`/admin/ports`), metric history charts (`/admin/metrics`), correlated assurance timeline (`/admin/timeline`), DPI traffic reports (site + per guest) |
| **Remediation** | Device restart / PoE power-cycle / locate, SSH suite (diagnostics allowlist, audited command box, interactive terminal), **per-port packet capture** (bounded audited tcpdump → `.pcap` download), **client block/unblock with required reason + who/when recorded**, guided troubleshoot runbooks (5) |
| **Alerting** | Background monitor: offline/subsystem/CPU/memory/firmware, switch-port saturation + interface errors, suspected rogue extenders; batched email+webhook digests; diff-based writes |
| **Security & governance** | Role-based admin accounts (admin/operator/monitor + traffic grant), TOTP 2FA + recovery codes, login rate limiting (admin + guest), full audit trail with CSV, secrets encrypted at rest (AES-256-GCM), admin-path firewalling via Pangolin Check/Apply |
| **Data protection** | Per-location retention/anonymization policies, SAR export, right-to-erasure, audit-log retention window, GDPR.md |
| **Ops** | CI build/publish + semantic-release versioning, one-command setup/deploy scripts with registry pull token, health-checked deploys with image pruning, in-app version/build footer |

## Where we stand vs. commercial tools

The product now spans three categories: **guest-WiFi captive portals** (UniFi's
built-in Hotspot, IronWiFi, Purple.ai, Cloud4Wi, Cisco Meraki splash),
entry-level **network monitoring / assurance** tools (SolarWinds NPM, Cisco
DNA Center, Auvik), and, as of the 2026-07-06 blocking/rogue-extender work, the edges of **network access control / wireless security** (UniFi's native
threat management, PacketFence-class NAC). This section is reviewed as of
2026-07-06.

**Competitive-to-ahead on the guest-portal side:**
- Custom-branded, location-aware registration flow; dark mode; served over
  HTTPS via a self-managed Pangolin reverse-proxy integration (one-click
  Check/Apply of the proxy resources, admin-path firewalling).
- Guest self-service: login, live device list, labels, add/remove, profile,
  magic-link handoff out of the captive webview.
- Admin: sessions view, logs + CSV, users directory, act-on-behalf
  (create/add-device/revoke/delete), per-guest usage & DPI traffic reports,
  one-click UniFi hotspot config.
- **Verified identity** - email verification (free window -> emailed link ->
  full access) with fully branded, GUI-authored mail.
- **Vouchers** - batch-generated codes (own duration/bandwidth/quota/uses),
  redeemable on the form, waiving email verification.
- **Tiered plans** - per-location duration/bandwidth/quota/device-cap, plus
  **event mode** (auto-tag registrations during an event window, per-event
  counts + CSV). Precedence: voucher > event > location > site default.
- **Expiry notifications** - branded pre-expiry email with a renew link.
- **Governance** - per-person accounts, three least-privilege roles, TOTP 2FA,
  a full audit trail, and per-location data-retention / PII auto-purge (GDPR-
  style), applied by a scheduled job.

**Network monitoring / assurance side (newer, partial):**
- **Network Map** - live topology (gateway -> switches -> APs) grouped by
  uplink, status-colored, with per-device client counts and port/VLAN detail.
- **Status + assurance** - per-device health (CPU/mem/uptime/firmware), site
  health subsystems, and a derived issues list; guided troubleshooting
  runbooks (guest-can't-connect, device-offline, portal-not-redirecting,
  controller-unreachable, VLAN/trunking trace).
- **Remediation** - restart / PoE-port power-cycle / locate from the map, and
  SSH tooling (read-only diagnostics, an audited command box, and an
  interactive terminal) into devices.

**Security side (newest, honest accounting):**

What a WIDS/WIPS or NAC product does vs. what this portal does today:

| Capability | UniFi native / NAC tools | Us |
|---|---|---|
| Rogue consumer extender/mesh detection among *clients* | Nobody does this well, WIPS tools watch for rogue *APs*, not client-side extenders | ✅ Shipped 2026-07-06 (OUI + hostname heuristic, alert rule, block action) |
| Client block/quarantine with accountability | UniFi blocks but records no who/why/when; NAC tools do | ✅ Shipped 2026-07-06, required reason + admin + timestamp, audited |
| Rogue **AP** detection (foreign SSIDs/BSSIDs in the air) | UniFi collects neighboring-AP scans natively; WIPS tools alert on them | ✅ Shipped 2026-07-06, `/admin/rogue-aps` lists the scan and alerts on neighbours spoofing our SSIDs |
| New/unknown device visibility | NAC quarantines unknown MACs by default | ✅ Shipped 2026-07-06, optional first-seen alert on a never-before-seen MAC (SeenDevice baseline) |
| Admin auth hardening | Enterprise SSO/SAML in commercial tools | ✅ Per-person accounts, roles, TOTP 2FA, recovery codes, rate limiting; ❌ no failed-login *alerting* (audit records denials silently, Phase 8) |
| Secrets & data at rest | Varies wildly | ✅ AES-256-GCM column encryption, per-location retention/erasure |
| Vulnerability management of the product itself | Vendor's problem in SaaS | ❌ No dependency audit step in CI (Phase 8) |
| Config/DB backup & restore | Appliance-style export/restore | ⚠️ Manual, a `backups/` convention exists on the host but nothing scheduled or documented (Phase 8) |

**Remaining gaps (in rough order of relevance here):**

| Gap | Who has it | Notes for us |
|---|---|---|
| Guest-visible time-remaining / self-serve renew UI | UniFi Hotspot, Meraki | ✅ Shipped 2026-07-06: `/portal/my-devices` now ticks the countdown client-side every 30s instead of showing a static server-rendered string at page load. |
| SMS OTP as a login credential | IronWiFi, Purple, Cloud4Wi | Phone + last name is still the (unverified) login; email is the verified channel. Deliberately deferred (2026-07-06): SMS OTP's per-message cost isn't worth it for this deployment's scale. |
| Historical trend charts (usage/throughput over time) | Meraki, Cloud4Wi, SolarWinds | ✅ Shipped 2026-07-05: the **Metrics** page charts sampled WAN throughput, client counts, and WAN latency over 6h/24h/7d/30d from a retained `MetricSample` time series. |
| Alerting / notifications on network events | SolarWinds, DNA Center, Auvik | ✅ Shipped 2026-07-04: background monitor opens/resolves alerts on device/subsystem/CPU/memory/firmware and notifies by email + webhook, batched to avoid storms. Extended 2026-07-05 with per-switch-port **link-saturation** and **interface-error/discard** thresholds, and 2026-07-06 with suspected consumer WiFi extender/mesh-node detection. |
| Historical assurance / event timeline | DNA Center, Meraki | ✅ Shipped 2026-07-06: **Timeline** page overlays alert onset markers and event spans on the connected-clients metric chart on one shared time axis, plus a chronological detail list. |
| Multi-site | All of them | Schema stores `site`; config is single-site. Scoped 2026-07-06: `unifiSite` is threaded into all 17 UniFi call sites across 18 dependent files, real concurrent multi-site support is a large rewrite, not a small addition. Still low priority until a second site exists; deliberately deferred. |
| Wired-client / switch-port inventory view | SolarWinds, Auvik | ✅ Shipped 2026-07-06: `/admin/ports`, flat, searchable table of every switch port site-wide, joined with the connected client (if any). |

Not worth chasing: social login, marketing/analytics funnels, ad injection,
payment plans, SNMP polling of **non-UniFi** gear - wrong fit for this
network. (SNMPv3 *fallback* polling of the adopted UniFi fleet, scoped
narrowly to reachability during a controller outage, shipped 2026-07-15 -
see Phase 18 below; that is a different, much smaller thing than general
SNMP monitoring.)

## UniFi integration: what the controller already knows that we don't show

All available on the Network Application API we already authenticate to
(classic paths; automatically proxied under `/proxy/network` for UniFi OS):

1. **Per-client usage history** - `POST /api/s/{site}/stat/report/hourly.user`
   (and `daily.user`) with `{ attrs: ["time","rx_bytes","tx_bytes"], macs, start, end }`.
   Hourly retention is controller-configurable (default ~30 days). This powers
   "usage over time" charts per device/guest without us storing anything.
2. **Session history** - `POST /api/s/{site}/stat/session` with
   `{ type: "all", start, end, mac }`: connect/disconnect times, AP, duration
   per session. Better than our current single `lastSeenAt`.
3. **Site-level trends** - `stat/report/hourly.site` / `daily.site` for the
   admin dashboard (total guest traffic, client counts, WAN throughput).
4. **DPI - "where users are going"** - requires DPI enabled on the gateway:
   - `POST /api/s/{site}/stat/sitedpi` `{ type: "by_app" | "by_cat" }` - site-wide
     app/category breakdown.
   - `POST /api/s/{site}/stat/stadpi` `{ type: "by_app", macs: [...] }` - per-client
     app/category bytes (e.g. "Netflix 4.2 GB, Steam 1.1 GB").
   DPI identifies apps/categories, not URLs or browsing history. Anything
   deeper (DNS/flow logs) is a different tool and a policy decision - per-user
   browsing surveillance needs sign-off and a disclosure in the terms of use
   before we build UI for it.
5. **Data quotas** - `authorizeGuest` already supports `bytes` (MB quota);
   `AuthorizeGuestOptions.bytesQuotaMB` exists in `src/lib/unifi.ts` but no
   setting feeds it. Cheap win.
6. **Vouchers** - `POST /api/s/{site}/cmd/hotspot` `{ cmd: "create-voucher", ... }`
   plus `stat/voucher`, if/when we add voucher flows.

## Phased plan

### Phase 1 - surface what UniFi already has (no schema changes, ~small)
- [x] "Time remaining" + one-click **Renew** on `/portal/my-devices`
      (compute from `authorizedAt + durationMin`; renew = re-run `authorizeGuest`
      and insert a fresh registration row - same path the captive portal uses).
- [x] Per-device **usage sparkline + totals** on my-devices and on the admin
      user detail page (`stat/report/hourly.user`, cached like `liveStatus.ts`).
- [x] Admin dashboard: site traffic + guest-count charts (`daily.site`).
- [x] **Data quota setting** (`guestQuotaMB` in SystemSettings -> `bytes` on
      authorize), shown to the guest at registration.
- [x] Session history table on the admin user page (`stat/session`).

### Phase 2 - identity & admin hardening
- [x] **Verified contact identity** - shipped as **email verification**
      (chosen over SMS OTP, 2026-07-03): short free window at registration,
      emailed confirmation link that auto-signs the guest in, grace window
      + resend on lapse, unverified guests blocked from device adds. SMS
      OTP remains a possible future addition as a login second factor.
- [x] **Admin accounts table** (username + scrypt hash, roles: admin/operator/monitor)
      replacing the single shared password; session carries the admin identity.
      Shipped with per-account TOTP 2FA (self-service enrol at /admin/account).
- [x] **Audit log** (who revoked/created/edited what, when - admin actions,
      guest self-service mutations, logins/denials, traffic lookups; viewer
      with filters + CSV at /admin/audit, full admins only).
- [x] **Retention policy**: hourly in-process job anonymizes registrations
      N days after expiry/revocation, with the policy set **per location**
      (keep forever vs anonymize - permanent vs temporary staff), a global
      default for location-less rows, and an audit-log retention window;
      manual "Run now" + last-run stats in Settings -> Locations.

### Phase 3 - traffic visibility (decision gate: privacy sign-off first)
- [x] Site-wide **apps/categories dashboard** (`/admin/traffic`) - via the
      v2 traffic API (classic `sitedpi` is empty on UniFi OS gateways); DPI
      was already enabled on the gateway.
- [x] Per-guest app/category breakdown on the admin user page - gated behind
      a per-account **canViewTraffic** grant (Settings -> Admins toggle)
      instead of the not-yet-built audit log.
- [x] Update terms of use to disclose traffic categorization (full terms text
      written 2026-07-03 - was previously empty; editable in Settings -> Portal).
- [x] Audit log of traffic lookups (`traffic.site_view` / `traffic.guest_view`
      entries - shipped with the Phase 2 audit log).

### Phase 4 - access flexibility
- [x] **Vouchers**: admin-generated codes (duration/bandwidth/uses) redeemable
      on the portal - covers visitors without usable phone numbers. *(Done
      2026-07-03: portal-native `/admin/vouchers` + "Have a voucher code?"
      on the registration form.)*
- [x] **Tiered plans**: per-location duration, bandwidth, quota, and device
      cap instead of one global default (locations are editable entities as
      of 2026-07-03, so this hangs off the `Location` model). *(Done
      2026-07-03: Settings -> Locations -> Access Plan.)*
- [x] Expiry-warning notifications (email) - *(Done 2026-07-03: Settings ->
      Email -> Expiry Notifications; SMS remains out of scope.)*

### Phase 5 - network visibility & troubleshooting (Cisco DNA Center-style)
- [x] **UniFi status page**: device health for APs/switches/gateway
      (`stat/device` without the AP filter: state, uptime, firmware, CPU/mem,
      port/radio status) plus site health (`stat/health`), surfacing issues
      like offline/adopting devices at a glance. *(Done 2026-07-03:
      `/admin/status` - also shows per-AP client load and channel
      utilization, covering part of the next item.)*
- [x] **More UniFi stats** on the admin dashboard: WAN throughput tile plus a
      live per-AP client-load breakdown (busiest first, links to /admin/aps).
      *(Done 2026-07-06.)*

### Phase 6 - network operations toolkit (remediation, not just visibility)

Planned 2026-07-06, after the rogue-extender work showed the gap: the portal
can now *see* problems well, but an operator's next click - "make it stop" -
mostly still lives in the UniFi UI.

- [x] **Block problem devices** with accountability: block/unblock
      (`cmd/stamgr` block-sta) from every client row (Clients page,
      rogue-extender alerts, guest device list), requiring a reason and
      recording who/when; blocked-devices list on /admin/clients so a
      disconnected (blocked) device can still be unblocked. *(Done
      2026-07-06, PR #75.)*
- [x] **Unified issues board + interference visibility**: /admin/issues
      pulls device/subsystem health, flapping links (controller event log),
      congested radios, weak-signal clients, open alerts, and blocked devices
      into one filterable board, with the same issues badged on the Map and
      the new /admin/aps tab. *(Done 2026-07-06, PR #82, supersedes the
      planned "interference runbook"; a step-by-step guided variant can still
      be added to /admin/troubleshoot later if wanted.)*
- [x] **DHCP-pool exhaustion check**: per-network pool usage (approximated
      from connected clients whose IP is in the DHCP range) on /admin/status,
      plus a `dhcp_pool` alert at ≥90% used. *(Done 2026-07-06.)*
- [x] **Per-client throttle** as soft remediation: a **Throttle** action on
      the Clients table (beside Block) puts a client in a UniFi user group with
      a chosen down/up rate; un-throttle returns it to Default. Audited,
      full-admin, local `ThrottledDevice` state. *(Done 2026-07-06.)*
- [x] **Network health score** on the dashboard: a 0, 100 rollup (ring +
      contributing factors) derived from open alerts, offline devices, and
      unhealthy subsystems, linking to /admin/issues. *(Done 2026-07-06.)*
- [x] **Speedtest history**: the gateway's periodic speedtest (down/up Mbps,
      already sampled into MetricSample) is charted on /admin/metrics beside WAN
      latency, separating ISP degradation from local problems. *(Done 2026-07-06.)*

### Phase 7 - quality of life & hardening

From the 2026-07-06 full-codebase debug pass (whole repo typechecks clean;
findings were UX/robustness, not correctness):

- [x] **Clients/Ports filtering**: Clients gains search + wired/wireless +
      flagged-only; Switch Ports gains per-switch, up/down, and PoE-only
      filters. *(Done 2026-07-06, PR #82; periodic auto-refresh on those
      pages is still open.)*
- [x] **Proper block dialog**: the block-reason input is now the shadcn Dialog
      (validation, mobile-friendly) instead of `window.prompt`. *(Done 2026-07-06.)*
- [x] **CSV export** for Clients and Switch Ports (Export CSV button over the
      filtered rows, via the shared toCSV helper). *(Done 2026-07-06.)*
- [x] **Timeline drill-down**: alert/event markers on the timeline strip and
      the detail-list rows are now links to /admin/alerts and /admin/events.
      *(Done 2026-07-06.)*
- [x] **Separation of duties**: the account PATCH route rejects (403) an admin
      changing their *own* role or their *own* traffic-data access, those must
      go through another admin, so no single account can self-escalate. *(Done
      2026-07-06.)*
- [x] **Scheduler single-run guard**: `acquireSchedulerLock()` holds a Postgres
      session-level advisory lock on a dedicated connection at boot; only the
      holder runs the background schedulers, so a second container won't
      double-run them. Fail-open (the sole instance always runs). *(Done
      2026-07-06.)*
- [x] **Production retention nudge**: dashboard banner (dismissible) shown
      until a finite retention/anonymisation period is set for the global
      default or a location. *(Done 2026-07-06.)*
- [x] **Bulk actions** on the Users directory: multi-select rows (+ select-all
      on the page) and delete several guests at once (each delete disconnects
      the guest's active devices and removes their registrations). *(Done
      2026-07-06.)*
- [x] **Persistent table filters**: Users/Logs/Audit filters persist across
      visits via a localStorage-backed `usePersistentState` hook. *(Done
      2026-07-06.)*

### Phase 8 - security hardening (from the 2026-07-06 WIDS/NAC comparison)

Ordered by value-for-effort on this network; none require new infrastructure.

- [x] **Rogue AP detection**: `/admin/rogue-aps` surfaces the controller's
      neighbouring-AP scan (`stat/rogueap`), flags any neighbour broadcasting
      one of our SSIDs (evil-twin), and raises a `rogue_ap` alert (open copies
      rated highest). *(Done 2026-07-06.)*
- [x] **First-seen device alert** (optional, off by default): a `SeenDevice`
      table records every MAC ever seen (maintained each poll cycle regardless
      of the toggle, so enabling it later doesn't flag the fleet); when on, a
      never-before-seen MAC opens a one-shot `first_seen` alert. *(Done
      2026-07-06.)*
- [x] **Failed-admin-login alerting**: the alert monitor now reads the audit
      log each cycle and opens a `failed_login` alert when one source IP has ≥5
      failed admin logins in 15 min, feeding the existing email/webhook digest;
      self-clears when the burst ages out. *(Done 2026-07-06.)*
- [x] **Dependency audit in CI**: `npm audit --omit=dev --audit-level=critical`
      step in `release-and-publish.yml`, before the release is cut, so a
      critical advisory in a production dependency can't ship unnoticed. *(Done
      2026-07-06.)*
- [x] **Scheduled DB backup + restore runbook**: `install.sh backup` (nightly
      `pg_dump` → `backups/`, 14-day rotation, atomic write, disk warning) plus
      `install.sh restore` (newest-or-named dump, schema reset, `ON_ERROR_STOP`,
      confirmation) documented in README "Backups & health". *(Done
      2026-07-06.)*
- [x] **Security response headers**: `next.config.mjs` sets CSP (locked-down
      except `'unsafe-inline'` for Next's inline hydration script/style, nonce
      wiring is a follow-up), HSTS (180d), `frame-ancestors 'none'`/X-Frame-
      Options DENY, nosniff, Referrer-Policy, and a deny-all Permissions-Policy,
      on every route. *(Done 2026-07-06.)*

### Phase 9 - DONE 2026-07-07 (PRs #124, #125, shipped in v1.23.0)

Two features scoped 2026-07-06, built and deployed the next day. Both plug
into the existing alert engine / settings patterns. The original scoping is
kept below for the record, with each "resolve first" item's outcome noted.

#### 9A. UniFi API-key authentication (optional, *alongside* the local account)

Motivation: the UniFi connection settings only expose username/password because
this app uses the **classic** Network controller API throughout, cookie login
(`/api/auth/login`), `cmd/stamgr` (guest authorize), `/rest/user` (client note),
`/rest/usergroup` (throttle), `stat/*`. Newer UniFi OS (Network 9+/UniFi OS 4+)
adds an **Integration API** keyed by an `X-API-KEY` header.

Honest limitation to design around: the Integration API
(`/proxy/network/integration/v1/…`) today covers only a **subset**: list
sites/clients/devices and a few actions. It does **not** cover guest
authorization with bandwidth/quota, client notes, user groups (throttle),
sessions, events, or DPI/traffic. So an API key **cannot replace** the local
account for a captive portal; it can only *supplement* it for the read/monitoring
calls that have an equivalent.

Plan:
1. **SystemSettings lockstep** (schema + migration, `useAdminSettings`, settings
   route, UniFi settings page): add `unifiApiKey` (stored via `encryptSecret`,
   like the other secrets). Field is a password input with helper text: "supplements,
   does not replace, the local account; requires UniFi OS 4+ / Network 9+."
2. **unifi.ts**: an additive `integrationRequest(path)` that sends `X-API-KEY` to
   `/proxy/network/integration/v1/…`, plus a capability probe
   (`GET …/integration/v1/sites`) used by a **"Test API key"** button.
3. Route the **monitoring reads** (device/client lists) through the API key when
   present *and* the endpoint exists, else fall back to the cookie session, one
   client, not a fork. Writes/guest-auth stay on the local account.
4. **Settings UX**: "Test connection" reports which auth each capability resolves
   to (local vs API key).
5. **Docs**: README UniFi-setup section + the version requirement.

Resolved (2026-07-07, PR #124): the live controller **has** the Integration
API (`/proxy/network/integration/v1/sites` answers 401 without a key, not
404); the key uses the standard `encryptSecret` path. Read precedence went
the *other* way than sketched, **cookie-first with Integration-API
fallback**, because the integration payloads lack `system-stats` /
`port_table` / VLAN fields, so preferring the key would silently disable the
CPU/mem/port alert rules. With a key set, `listStations`/`listDevices`
degrade to key-authed basic rows when the cookie login fails (locked
account, changed password) instead of going dark.

#### 9B. Duplicate-IP false-positive suppression

Motivation: on the base network (VLAN 420 `BASE-NET`, `10.91.0.0/21`)
UniFi fires hundreds of duplicate-IP warnings that are **false positives** from
MAC randomisation, two randomised MACs that historically held the same IP.
ARP testing confirmed no live conflict. Goal: gate these before they reach the
operator, **without** ever hiding a genuine conflict.

Design, a suppression gate feeding the existing engine (`alertMonitor.runAlertCycle`,
`alerts.ts` `AlertType` union, the pure `evaluate*` → `DesiredAlert[]` pattern):
1. **Source**: poll UniFi alarms (`stat/alarm`) each cycle for duplicate-IP
   entries (add `listAlarms()` to unifi.ts); parse reported IP + the two MACs +
   VLAN. (UniFi has no native webhook for this; polling matches the engine. A
   webhook-ingress endpoint is a stretch goal.)
2. **Four confidence checks** in a new pure/testable `src/lib/dupIp.ts`, ordered
   cheap → expensive, short-circuiting:
   - **(a) MAC randomisation**: `isLocallyAdministered(mac)` = `(firstOctet & 0x02) !== 0`.
     Both randomised ⇒ strong false-positive signal. (Pure, run first.)
   - **(b) Session overlap**: compare `last_seen` of the two client records
     (`stat/sta`/`stat/alluser`); non-overlapping active sessions ⇒ suppress/downgrade.
   - **(c) DHCP lease cross-reference**: count currently-connected clients holding
     the reported IP (from `stat/sta`; same connected-client proxy the DHCP-pool
     feature uses). Exactly one active holder ⇒ false positive.
   - **(d) ARP validation** (authoritative, heaviest, only if a, c inconclusive):
     SSH to a device with an interface on the alarm's VLAN and run a bounded
     `arping -c 3 -w 2 <ip>` (or read `ip neigh` for multiple MACs where arping is
     absent on busybox); >1 distinct responder MAC ⇒ genuine conflict. Reuse the
     SSH tooling (`deviceSsh.ts`, `DIAGNOSTICS` allowlist pattern, full-admin +
     audited), rate-limited so an alarm storm can't hammer a switch.
3. **Decision**: genuine ⇒ open a new `duplicate_ip` alert (add to `AlertType`);
   otherwise record as suppressed.
4. **Separate suppressed log** (never silently drop): new `SuppressedAlert` table
   (ip, macA, macB, vlan, reasons[], firstSeen, lastSeen, count) + a read-only view
   (a tab on `/admin/alerts` or its own page) so suppression is auditable and a
   genuine conflict is never hidden.
5. **Settings** (Monitoring): master toggle, per-check enables, and the
   arping device/VLAN mapping.

Resolved (2026-07-07, PR #125): the live `stat/alarm` payload could **not**
be captured pre-build (the `.env` controller creds are stale; live creds are
DB-encrypted), so the parser is defensive, structured fields first,
message-text regex fallback, and **dry-run mode defaults ON**: enable the
gate, watch the suppressed log on /admin/alerts classify real alarms for a
few days, then turn dry-run off. The SSH host per VLAN is an explicit
`vlan=device MAC` map in Settings → Monitoring (usually the gateway, whose
per-VLAN bridges are `br<vlan>`); arping availability is likewise unverified
on-device, so the probe runs `arping -c 3 -w 2` with an `ip neigh` fallback,
a 10-minute per-IP cooldown and a 3-probe-per-cycle budget. Checks (a), (c)
are pure in `src/lib/dupIp.ts` with 15 unit tests on Node's built-in runner
(`npm test`, the repo's first tests).

> **Interlude (2026-07-07, v2.0.0, v2.0.1, out of phase order):** portal-managed
> **Traefik replaced Pangolin** (routes via the token-gated HTTP-provider
> endpoint, Proxied Resources editor, Cloudflare DNS-01 certs, GUI-owned
> config, `traefik-ops` restart sidecar) and **macvlan was retired** (bridge
> networking + host ports; setup.sh lost its network preflight). The CI gate
> suite also landed (typecheck/gitleaks/migration-check/Trivy+Grype/npm cache,
> standalone 620 MB image, Snyk-style PR security gate + branch protection),
> plus the **develop-branch workflow** (direct pushes, patch-only builds,
> `:develop` image; `main` = promotion PRs only). The Phase 10 e2e branch
> predates v2 and needs a rebase (compose topology + workflow conflicts).
> **v2.1.0** followed the same day via the first develop→main promotion PR:
> the re-auth-gated Restart-Traefik button + `traefik-ops` sidecar
> (auto-applies static config), the Snyk-style PR security gate as a
> required check, and the develop-branch workflow itself.

> **Interlude 2 (2026-07-08, v3.0.0):** a day of operator-driven polish and
> pipeline hardening, released as v3.0.0 (over-bumped by a re-counted
> already-shipped breaking change - see docs/STATUS.md). Highlights:
> settings UX overhaul (toasts, dark-mode selects, layout fixes), admin
> account lifecycle (delete reason + password confirm, self-delete guard,
> expiry dates), what's-new dialog, channel-aware update check with a
> CI-baked encrypted token, UniFi hotspot custom_ip + pre-auth allowances
> fix, dual-auth connection test, guest sign-in that connects the new
> device, npm-less hardened runtime image, docs/ restructure, Security-Bot
> CI identity with scan-gated PR auto-approval, weekly Snyk Code reporting.


### Phase 10, test foundation. Shipped 2026-07-11

Playwright e2e smoke suite driving the flows that matter against the
**real container** with a **mock UniFi controller**, run in CI before
semantic-release so a broken flow blocks the release (no version, no
changelog, no image). Everything later in this plan leans on it (the CSP
change in particular). The old e2e branch turned out to be an empty stale
pointer at v1.27.0, so the suite was written fresh against the v2
architecture.

- [x] `test/mock-unifi/`: tiny dependency-free Node server. The real minimum
  surface grew a little beyond the original sketch: login needs 200 but **no
  Set-Cookie** (the client tolerates its absence, and a 200 on `/api/login`
  settles auto-detect on classic, avoiding the `/proxy/network` prefix);
  besides `cmd/stamgr` and `stat/sta`/`stat/device`, the admin pages and
  monitors the specs traverse read `stat/health`, `stat/alarm`,
  `stat/rogueap`, `rest/networkconf`, `rest/wlanconf` and POST `stat/event`
  — all `{data:[]}`. A catch-all answers anything else empty and logs it, so
  surface drift shows up in the failure dump instead of breaking the suite.
  Every request is recorded and served on `GET /__requests` for assertions.
- [x] `docker-compose.test.yml`: throwaway db (tmpfs) + portal (image under
  test; the entrypoint self-migrates) + mock-unifi on a plain bridge, no
  published ports, no Traefik.
- [x] Specs (ordered, one worker): (1) first-time-setup bootstrap (blank
  username + `ADMIN_PASSWORD` → create the first admin, retry-idempotent)
  and UI login; (2) settings round-trip that points `unifiUrl` at the mock
  and gets a green Test Connection; (3) guest registration from
  `/guest/s/<site>/?id=<MAC>` to the success page, asserting the mock
  received `authorize-guest` with the canonical MAC; (4) self-service login
  + `/portal/my-devices` shows the registered device.
- [x] CI: `release-and-publish.yml` builds a throwaway candidate image, runs
  the suite via `test/e2e/run.sh` (Playwright in the official browsers
  container, pinned 1.61.1, joined to the compose network — no bind mounts,
  which don't survive this runner's docker-out-of-docker), then proceeds to
  semantic-release only when green. `ci.yml` and `nightly-build.yml` are
  deliberately untouched; e2e on PRs is a possible follow-up once PR-time
  image builds are acceptable.

### Phase 11, security follow-ups. Shipped 2026-07-11

1. [x] **CSP nonce wiring** (the explicit Phase 8 leftover): the CSP moved
   from next.config.mjs to per-request construction in `src/proxy.ts` — a
   fresh nonce per page load, `script-src 'self' 'nonce-…' 'strict-dynamic'`
   with NO `'unsafe-inline'`, stamped onto the theme bootstrap script and the
   brand-color block in the root layout; Next stamps its own inline scripts
   from the request's CSP header. Honest scope note: `style-src` keeps
   `'unsafe-inline'` — React style attributes are pervasive (charts, the
   map's pan/zoom transform) and inline styles are not the XSS vector inline
   scripts are. Verified by a new e2e spec (05-csp): nonce present, no
   script-src unsafe-inline, hydration alive, zero CSP console violations.
2. [x] **Failed-login alert thresholds → settings**: `alertFailedLoginCount`
   / `alertFailedLoginWindowMin` on SystemSettings (defaults 5 / 15 matching
   the old constants), editable on Settings → Monitoring, 0 disables the rule.
3. [x] **Hash-chained audit log**: every new AuditLog row stores
   SHA-256(previous hash + canonical row) — appends are serialized by a
   Postgres advisory lock so concurrent writers can't fork the chain, and the
   scheduler writers go through the same path. "Verify chain" on /admin/audit
   walks the whole log and points at the first broken link; rows from before
   the feature (and the anchor, whose predecessor retention may have pruned)
   count as unverifiable, never as tampered. Honest scope: detects silent row
   edits/deletions; it does not stop an attacker who can rewrite the whole
   chain.

### Phase 12, ops robustness. Shipped 2026-07-11

1. [x] **Notification retry/backoff**: alert email and webhook sends get
   bounded retries with backoff (worst case well inside the poll interval);
   exhausting them writes an `alert.notify_deadletter` audit entry naming the
   channel, target and last error. A webhook answering non-2xx now counts as
   a failure instead of a silent success.
2. [x] **UniFi alarm webhook ingress** (the 9B stretch goal):
   `POST /api/webhooks/unifi-alarm` with `Authorization: Bearer <secret>`
   (secret in Settings → Monitoring, encrypted at rest; endpoint 404s until
   one is saved). A push triggers an immediate, debounced alert cycle — the
   same dup-IP gate and alert engine, minus the poll latency. The body is
   deliberately not parsed: the cycle re-reads the controller's alarm list
   itself, so a forged payload can inject nothing. Wrong secrets are rate
   limited and answered timing-safely.
3. [x] **WCAG pass**: axe-core (wcag2a/aa + wcag21a/aa) rides the e2e suite
   over the guest portal (chooser, registration form, self-service login)
   and admin pages (login, dashboard, Network Status). One critical finding
   fixed (unlabelled admin login inputs — labels are htmlFor-associated
   now). color-contrast is excluded, stated openly: the palette is
   operator-brandable, so contrast is a theming decision, not a rule to
   silence per element.

### Phase 13, controller write-backs. Shipped 2026-07-08/09

- [x] **Firewall one-click apply** on the Network Review tab. Idempotent under
  a `Portal: ` name prefix, so re-applies skip by name. It never touches other
  rules, is full-admin gated and audited, and aborts on the first controller
  rejection, so a failed ALLOW can never be followed by BLOCKs.
- [x] **Zone-based firewall writes**, planned natively in Policy Engine
  vocabulary rather than translated from classic rules. Verified against a live
  UniFi Network 10.x controller.
- [x] Guard rails. The apply is refused if it would sever the requesting
  admin's own session or cut off a declared critical address.

### Phase 14, network security suite. Shipped 2026-07-09

- [x] **Critical addresses**: a never-cut-off guard, plus opt-in ALLOW policies
  driven by a service picker (well-known ports, TCP/UDP per service, ICMP).
- [x] **PCI/POS segmentation check** with guarded *Apply fixes*. It writes
  explicit blocks for zone-default and unpoliced flows. Zone mixing and custom
  broad allows are reported for manual work.
- [x] **Firewall path test** (what-if against the live policy table) and
  **firewall cleanup** (guarded delete of stale and portal policies).
- [x] **Configuration health** checks: WLAN security, UPnP, IDS/IPS, firmware
  auto-upgrade, segmentation.
- [x] **Rogue UniFi devices** (nav said "Un-onboarded" until 2026-07-11): detection, SSH probe, terminal by IP, and
  ignores that are either permanent or lifted on reconnect.
- [x] **UniFi backup accounts** with per-account lockout failover.
- [x] **Admin surface isolation** (host gating, optional management CIDRs) and
  the permission-model corrections.
- [x] **Microsoft 365 mail** provider (Graph sendMail, free shared mailbox)
  with a per-mailbox send log.

### Phase 15, device-ignore correctness. Done 2026-07-11 (raised 2026-07-09)

Review of the nightly ignore work found the feature half-kept its promise. The
device list was filtered everywhere it mattered, but the controller's own
health counts, and several surfaces that never learned about ignores at all,
still saw the device. Items are ordered by severity; the first three were
bugs. All eight were fixed on 2026-07-11.

1. [x] **Per-device dialog state.** `DeviceDialog` held the ignore note and
   error across devices, so one device's note could be submitted as another's
   audit justification. *Fixed: the dialog body is keyed by MAC, remounting
   all per-device state on device change.*
2. [x] **Subsystem status.** `adjustHealthForIgnored` corrected the counts but
   not `h.status`, so the subsystem issue and alert survived the ignore.
   *Fixed: status resets to ok only when every raw disconnect is attributable
   to ignored devices, so a degradation owed to anything else survives.*
3. [x] **Transitional states.** The subtraction counted any `state !== 1`
   device as disconnected. *Fixed: only state 0 is subtracted. Whether the
   controller counts only state 0 under `num_disconnected` is still unverified
   live; if it also counts transitional states, the error now shows as a
   phantom disconnect instead of masking a real outage.*
4. [x] **Unmapped device types.** `subsystemOf` knew `uap` and `usw` only.
   *Fixed 2026-07-11: `ubb` counts against wlan (assumption noted in the code),
   and the adjustment gained a floor — the disconnected count never drops below
   the visibly offline devices of that subsystem, so a wrong mapping shows a
   phantom disconnect instead of hiding a real one. `cn` is a naming token,
   not a controller type; nothing to map.*
5. [x] **One choke point.** *Fixed 2026-07-11: `applyDeviceIgnores` in
   `src/lib/ignoredDevices.ts` sweeps, filters and adjusts in one call, adopted
   by every reader — map, status, issues board, alert monitor, APs page,
   dashboard score, live route, metric sampler and the offline runbook (which
   now names the skipped devices).*
6. [x] **Table interaction.** *Fixed 2026-07-11: Network Status rows use the
   APs table's selection guard for drag-to-copy and dropped `role="button"`;
   keyboard access stays via tabIndex + Enter/Space.*
7. [x] **Issue parity.** *Fixed 2026-07-11: Network Status fetches controller
   events and hands the dialog the same `collectIssues` grouping as the map.*
8. [x] **Duplication.** *Fixed 2026-07-11: labels and the uptime formatter
   live in `src/lib/deviceLabels.ts`; the issue grouping is
   `groupIssuesByDevice` in `src/lib/issues.ts`.*

Also from the same session, both fixed 2026-07-11: `sendMail` now awaits the
`EmailLog` insert so the Send-activity card's immediate refresh after a test
send sees the row, and that card's poll follows the site-wide `liveRefreshSec`
setting that the dashboard and alerts views honour.

### Phase 16 candidates (researched 2026-07-11 — items 1-13 SHIPPED that day)

A deep research pass over commercial hotspot portals (IronWiFi, Purple,
Cloud4Wi, Meraki), NOC products (UniFi's own app, Meraki Health, Auvik,
Cisco Catalyst Assurance) and open-source UniFi tooling (unpoller and its
Grafana dashboards, UniFi-API-client/browser, backup-decrypt tools),
graded for THIS deployment (single site, ~267 devices, guest WiFi on a
military base; no ad-tech, social login or payments). Feasibility note:
the classic API is confirmed usable on Network 10.x (UniFi-API-client
supports 5.x-10.x, 10.2.97 confirmed), but every endpoint below follows
the house rule — verify live before trusting, the reference material is
reverse-engineered.

**High value**

1. [x] **Sponsored guest access** — SHIPPED 2026-07-11 (see STATUS). A
   visitor requests access, a designated sponsor approves by clicking an
   expiring one-use email link; sponsor dropdown or wildcard-domain
   free-text, 24h default with per-visitor override, requester identity in
   the notification. Draft DoDI 8420.01 lets the Authorizing Official
   REQUIRE host-organization sponsorship for guest wireless, and DISA
   recommends per-user time-boxed credentials in high-threat environments —
   this is the compliance posture of the deployment, not a nicety. Effort:
   medium (sponsor-request table, approval route + email, portal step,
   settings).
2. [x] **DoD warning-banner mode** — SHIPPED 2026-07-11 (the WLAN-side
   inactivity timeout turned out to be a controller setting, stated openly
   in the settings card, not portal machinery). Originally: a
   click-through acceptance banner before access and a guest inactivity
   timeout (STIG says ≤30 min) as settings. Most of the plumbing exists
   (terms acceptance, per-plan durations). Effort: small.
3. [x] **Scheduled summary report** — SHIPPED 2026-07-11. Daily/weekly/monthly
   email with top-10 talkers by client/app/OS/manufacturer (DPI, already
   fetched), WAN health (loss/latency/uptime — per-WAN sampling exists),
   PoE consumption, guest/voucher stats (the classic hotspot collection
   exposes them directly). Effort: medium (report builder + scheduler ride
   the existing mail + metric machinery).
4. [x] **Controller config backup + diff** — SHIPPED 2026-07-11 as config
   HISTORY over the API's own config collections (cleaner diffs than .unf
   BSON dumps; the .unf stays a downloadable opaque restore artifact).
   Originally: (Auvik's model, classic API):
   trigger/list/download backups via the API; .unf files decrypt with a
   known hardcoded key into BSON dumps, so change-driven versioning with
   color diffs and an alert on config change is self-hostable. Explicitly
   no push-back/restore (Auvik's stance too). Effort: medium.
5. [x] **Per-client health + journey** — SHIPPED 2026-07-11 into the
   floating client window (score + 7-day event journey). Originally
   (Catalyst Client 360's model):
   deterministic health score from published RSSI/SNR thresholds plus
   onboarding outcome; a per-client timeline of associations, roams and
   failures. No dedicated roaming endpoint exists — the history is
   reconstructed from `stat/event` (3000-result cap) or gateway syslog,
   both proven by practitioners. Effort: medium-large.

**Medium value**

6. [x] **Connection funnel card** — SHIPPED 2026-07-11 on the Issues page. Failures broken into
   association → authentication → DHCP → DNS stages, ranked by SSID/AP/
   client type. Effort: medium.
7. [x] **Channel/airtime history** — SHIPPED 2026-07-11 (per-band airtime charts on the Metrics page; on-demand spectrum scan deferred as lower value). Originally: per-radio
   airtime/utilization history (sampler extension) and the classic
   `spectrum-scan` command + `stat/spectrumscan` results per AP. Effort:
   medium.
8. [x] **Top-talker insight cards** — SHIPPED 2026-07-11. On the dashboard (DPI per-client top-10s —
   the traffic page has the data; the dashboard lacks the cards). Effort:
   small-medium.
9. [x] **PoE budget view** — SHIPPED 2026-07-11. Per-switch PoE draw vs budget over time (port data
   already collected; Meraki reports include exactly this). Effort: small.
10. [x] **IDS/IPS + controller alarm feed** — SHIPPED 2026-07-11 as a collapsible card on the Alerts page. Originally: the classic
    `messages` collection exposes IDS/IPS events and alarms (unpoller has
    exported them since 2.0.2); the portal's alarm reads today serve only
    the dup-IP gate. Effort: small-medium.
11. [x] **Critical-client watchlist** — SHIPPED 2026-07-11 (Watch toggle in the client window; watched_client alert while connected). Originally: mark clients, alert on
    connect (first or every), with a tracking expiry — generalizes the
    first-seen machinery. Effort: small.
12. [x] **Audit syslog/SIEM forwarding** — SHIPPED 2026-07-11 (every audit event, RFC 5424 UDP + JSON payload; CSV export already existed). Originally (IronWiFi):
    every guest auth event with identity/device/timestamp, long retention,
    CSV/syslog export. Effort: medium.
13. [x] **Consent records + guest "my data" self-service** — SHIPPED 2026-07-11 (terms fingerprint per registration; Download-my-data JSON on the my-info page). Originally (Cloud4Wi MyData):
    explicit consent capture at registration and a guest-facing view of
    stored data (SAR export exists admin-side). Effort: small-medium.

**Low / parked**

14. Passpoint/PPSK onboarding (Cloud4Wi) — controller-side feature;
    investigate whether the base's WiFi policy even wants captive-less
    onboarding before spending anything.
15. Anomaly detection with learned baselines — Cisco's is cloud-only; a
    local variant (dynamic thresholds from weeks of MetricSample history)
    is possible later, after the simpler insight cards prove out.
16. Building/floor KPI heatmap with impact analysis (Catalyst Site
    Analytics) — attractive since building tokens already exist, but big;
    revisit after 5-7 ship.
17. Printable voucher sheets / touch voucher UI — vouchers exist; cosmetic.
18. GeoIP-enriched gateway syslog view — needs syslog ingestion infra.
19. Presence/footfall analytics and NAC-style device fingerprinting —
    out of scope for this deployment (ad-tech adjacent / different product).

### Phase 17, guest/admin separation (B + A-lite shipped + LIVE 2026-07-12; A-full remaining)

Explored 2026-07-11 (codebase facts below are verified). The question was
"split the admin side off the guest side". Three variants, graded. The user
asked for the full split on 2026-07-12; execution is staged.

**A-lite is now LIVE and verified on the example host** (`0a9d22f`, enabled
2026-07-12): two containers off one image on per-side Docker networks, behind
the bundled Traefik. Verified end-to-end (guest↔admin network isolation, admin
host serves `/admin` while the guest host 403s it, captive flow intact, admin
404s the guest APIs, control plane on the admin container). The db-net-admin
network was added live after the first enable revealed the guest and admin
shared the internal `db-net`. Known residual: the guest shares Traefik's `web`
network, so the admin URL is reachable *through* Traefik (auth + CIDR gated) —
direct container-to-container guest→admin is closed; full ingress separation is
A-full.

**Status (2026-07-12, on nightly):**
- [x] **B — hardening.** Alarm webhook bound to the admin host
  (`src/app/api/webhooks/unifi-alarm/route.ts` gates on `checkAdminAccess`
  wrong-host — host-only, so the controller can still post from outside the
  admin CIDR); `GUEST_SESSION_SECRET` + the split documented in `.env.example`;
  the `/_next/static` caveat stated below.
- [x] **A-lite — app-level core.** `PORTAL_MODE=guest|admin` (unset = "all",
  the unchanged single-container default) via `src/lib/portalMode.ts`, enforced
  in the middleware (the other side's pages 404), `requireAdmin` (all
  `/api/admin` 404 on a guest process), and `instrumentation.ts` (schedulers run
  only on admin, or `SCHEDULERS=off`). Backward compatible: no-op when unset.
  4 unit tests.
- [x] **A-lite — deploy wiring** (2026-07-12). `docker-compose.yml` gains a
  profile-gated `portal-admin` service (same image, `PORTAL_MODE=admin`
  pinned; enable with `COMPOSE_PROFILES=…,split` + `PORTAL_MODE=guest` in
  `.env`); `buildDynamicConfig` takes `adminServiceUrl` and routes the admin
  host at it (`adminUpstreamUrl()` in `src/lib/portalMode.ts`: automatic
  `http://portal-admin:3000` when the process runs split under the bundled
  Traefik, `ADMIN_UPSTREAM_URL` override for external ones); the URLs-page
  copy-out preview learns the value from the server so it matches what Traefik
  gets; `install.sh update` pulls/restarts/health-checks both containers when the
  profile is active. The proxy control plane moves to the admin process in a
  split: the bundled static config points the provider at the admin container
  (poll-status markers are process-local, and Traefik must not trust routes
  from the guest surface), a guest-role process 404s `/api/traefik/config` and
  never writes the static config. NOT yet verified on a live host (deploy
  topology — can't run in CI); enable steps in docs/OPERATIONS.md
  "Guest/admin split".
- [x] **A-lite — hardening pass** (2026-07-12, after a full review of the
  wiring). The split key is now the **compose profile**, not `PORTAL_MODE`
  alone (`splitProfileActive()`/`ownsProxyControlPlane()`): a lone container
  with `PORTAL_MODE` set but no `split` profile self-serves instead of pointing
  Traefik at a non-existent `portal-admin` (was a routing brick). Added:
  `src/lib/splitConfig.ts` + a boot-time `warnSplitConfig()` for the
  half-configured states (profile without mode, mode without profile, external
  split with no `ADMIN_UPSTREAM_URL`, blank/bare-IP/guest-shared admin host);
  `buildDynamicConfig` also dedupes the admin host against the **captive** host
  (colliding `Host()` routers could send captive traffic to the admin
  container); the admin process 404s the guest APIs `/api/portal` +
  `/api/sponsor` (per-process rate-limit would otherwise double the OTP
  budget); `admin-net` isolates the admin container from the guest network;
  `portal-admin` pins `SCHEDULERS=""`; `traefikStatic` escapes the provider
  endpoint (a stray quote in `ADMIN_UPSTREAM_URL` no longer breaks the YAML);
  `ADMIN_UPSTREAM_URL` is ignored in single-container mode (stale value after
  back-out); `install.sh update` fails closed on a `compose config` error and protects
  both containers' images from pruning; `install.sh setup` re-runs preserve `split` in
  `COMPOSE_PROFILES`; the URLs page refetches after save so the copy-out
  snippet can't go stale; `proxy-resources` uses the cached settings row. Docs
  (OPERATIONS/.env.example) corrected — the security claim now scopes to
  app + network level, not byte level. Still needs live verification.
- [ ] **A-full — two real builds.** Restructure into two Next apps sharing
  `src/lib` as a package (below). Large; the only route to zero admin bytes on
  guest hosts. Scoped, not started.

Original grading (do B now, then A-lite if process isolation is wanted, skip
A-full unless a compliance driver appears):

Baseline today (already shipped, Phase 14): `adminBaseUrl` set ⇒ `/admin` +
`/api/admin` return 404 on any other hostname (`src/lib/adminHost.ts`,
enforced in `requireAdmin` and the admin layout), plus an `adminAllowedCidrs`
source-IP allowlist. Traefik `blockAdmin` routers also 403 `/admin` +
`/api/admin` on the guest/captive hosts. Sessions are separate cookies
(`admin_session` vs `guest_session`); the guest key derives from
`ADMIN_SECRET` via `"guest-session-v1"` unless `GUEST_SESSION_SECRET` is set.
Schedulers are already double-run-safe (`src/lib/schedulerLock.ts`, a
Postgres advisory lock; only the holder runs them).

**B — harden the single app (small, ~1 day, recommended first).**
Concrete holes found by exploration:
- `POST /api/webhooks/unifi-alarm` answers on ALL hosts (only the shared
  secret guards it; it is under `/api/webhooks`, not `/api/admin`, so neither
  `requireAdmin`/`adminHost` nor the Traefik `blockAdmin` prefix covers it).
  Fix: bind it to the admin host via the existing `checkAdminAccess` /
  `adminHost.ts` helper when `adminBaseUrl` is set.
- Document `GUEST_SESSION_SECRET` in the env-vars reference so guest and admin
  session material can be fully separated by config.
- State honestly (README + here) that content-addressed admin JS chunks under
  `/_next/static` remain fetchable on guest hostnames — they are ungateable
  per-route in one Next app and carry no secrets; the admin HTML/APIs still
  404 there.

**A-lite — two containers from one image, one Postgres (moderate).**
Next standalone builds ALL routes into one `server.js` (no per-build route
exclusion), so the split is runtime, not build-time:
- `MODE=guest|admin` env, enforced in `src/proxy.ts` (hard-404 the other
  side's pages + APIs).
- `SCHEDULERS=off` (or MODE=guest implies it) so only the admin container runs
  the alert/metric/report/config-watch schedulers — the advisory lock already
  makes double-running safe, but explicit placement is cleaner.
- A SECOND Traefik service target: `buildDynamicConfig` (`src/lib/
  traefikConfig.ts`) currently hardcodes ONE `portal` service URL; add a
  second so guest-host → container A and admin-host → container B.
- Both containers still need `DATABASE_URL`, `ADMIN_SECRET` and the UniFi
  creds (the guest authorize path imports `unifi.ts`). Buys blast-radius
  isolation (a guest-side crash/leak can't touch the admin process) and clean
  scheduler placement — NOT byte-level separation (both serve the same
  `/_next/static`).

**A-full — two real builds (large, weeks).** The only route to genuinely zero
admin bytes on guest hosts: restructure into two Next apps sharing `src/lib`
as a package. Not worth it without a compliance requirement.

**C — two admin entry dashboards** (guest-ops landing vs NOC landing) — a pure
UX reshape of the existing nav (already grouped Guests / Network / System);
orthogonal, can ride any later batch.

Each phase is deployable on its own; nothing in a later phase blocks an
earlier one.

### Nightly work since Phase 16 (2026-07-12, direct user requests)

Net-new features built to nightly this day, outside the phased plan:

- **In-app load-test runner** (sidebar → System → Load test). Register remote
  generator boxes (the portal mints a per-box ed25519 key; a copy-paste
  one-liner installs it, a second grants docker-group access), launch the k6
  registration-burst harness over SSH, watch live per-shard/aggregated results,
  and one-click revoke the fake `aa:bb:*` MACs via the portal's own UniFi
  session. New `LoadTestHost`/`LoadTestRun` tables. Docs: docs/LOAD-TESTING.md.
- **Floating device windows.** The per-device popup is now a draggable,
  multi-instance window (like the client windows); every device in a window's
  uplink Path is clickable to open its own window. New
  `GET /api/admin/devices/[mac]`.
- **Rogue-AP signal locator.** Each rogue/neighbour AP expands to a radial
  signal map (our APs placed by RSSI — loudest = nearest) plus candidate
  on-network devices that might be broadcasting it (same OUI / MAC-adjacent to
  the BSSID). New pure `src/lib/rogueApLocate.ts`.
- **Port profiles** shown per port in the device popup's Ports table.
- **Admin nav / settings UX pass.** Sidebar's 14-item Network group split into
  Monitoring / Devices / Security; renamed Site health, Clients, Rogue UniFi;
  settings tabs grouped; Network Review + Load test moved out of Settings to
  top-level routes.
- **Ops:** a weekly systemd `docker-prune` timer on the dev/runner host.

### Phase 18, monitoring resilience. Shipped 2026-07-15 (nightly)

Prompted by the question "how would SNMP access improve the system"
(2026-07-15). Assessment: SNMP's one real value on this deployment is
monitoring that survives a controller outage; traps, richer counters, and
temperature are all cheaper or already covered elsewhere, and non-UniFi gear
stays the stated non-goal. Two stages, both shipped.

- [x] **Controller-outage watchdog**: every alert rule reads one controller
      snapshot per cycle, so an unreachable controller used to be silence,
      not a page — `alertMonitor.ts` bailed early by design (to avoid
      flapping every device alert to resolved) and nothing filled the gap.
      A `controller_down` alert now opens after N consecutive failed cycles
      (Settings → Monitoring, default 3) over email/webhook, neither of
      which depends on the controller; resolves on the first healthy poll
      through the normal diff. `alerts.test.ts` is the first unit coverage
      for the alert rule set.
- [x] **Raw device dump**: `GET /api/admin/devices/{mac}/raw` (settings-
      gated) for verifying per-model field availability against the live
      controller instead of assuming.
- [x] **Device temperature/fan display**: the floating device window shows
      the hottest reported sensor + fan level + overheating flag on models
      that report them; renders nothing on models that don't. The overheat
      *alert* rule is deliberately held pending a live field dump.
- [x] **SNMPv3 fallback poller**: while a `controller_down` alert is
      actually open (not on a single blip), the portal sweeps the last-known
      adopted device list (`SnmpTarget`, refreshed every healthy cycle, only
      on change) over SNMPv3 authPriv for basic reachability. Unreachable
      devices open a distinct `snmp_offline` alert (never the
      controller-derived `offline` type, so recovery stays unambiguous); a
      dashboard banner names the fallback summary while the outage lasts. A
      daily canary (3 sampled devices, healthy cycles only) catches broken
      credentials before an actual outage needs them. v3 authPriv only —
      no v1/v2c community-string support, by design, on a network this
      security-sensitive. "Test SNMP now" on Settings → Monitoring verifies
      credentials live. `net-snmp` added as a dependency (MIT, pure JS,
      verified on the standalone Alpine image before use). Network Review
      gained two config-health checks: v2c enabled on the controller, and
      the portal's fallback configured with nothing to poll.
      Sweep design deliberately outage-only (no full-fleet polling during
      healthy cycles — 267 extra UDP conversations per poll interval buys
      nothing the controller doesn't already provide).
