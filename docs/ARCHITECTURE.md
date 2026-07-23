# Architecture & Production-Readiness

This document records how the portal addresses common production-hardening
concerns, and, just as importantly, which ones are **deliberately out of
scope** for what this system is. Honesty about scope is the point: a
single-container guest captive portal for one UniFi site on a LAN does not
need (and should not pretend to have) the machinery of a multi-region SaaS.

**What this system is:** one Next.js container + one Postgres container on a
single Docker host, serving the guest captive-portal flow and an admin panel
for one UniFi site. Guest-facing hosts are fronted by a reverse proxy
(the bundled, portal-managed Traefik, or the operator's own) for TLS. It is not multi-tenant, not horizontally scaled, and not
handling regulated health data.

Status legend: **✅ implemented** · **➖ partial / by-design limitation** ·
**🚫 out of scope (with reason)**.

---

## Security

### Input sanitization & injection prevention, ✅
- All DB access is through **Prisma** (parameterised queries); the only raw
  SQL is `pg_advisory_xact_lock(hashtext($phone))` and two `Prisma.sql`
  tagged templates in `adminUsers.ts`, all parameter-bound, no string
  interpolation of user input.
- Request bodies validated with **Zod** schemas (`src/lib/validators.ts`);
  MACs canonicalised, phone digits normalised.
- **CSV export** neutralises spreadsheet formula-injection (`=`/`+`/`-`/`@`/
  tab/CR prefixes) in addition to structural quoting (`src/lib/csv.ts`,
  unit-tested), guest-controlled names/user-agents reach admin exports.
- **`primaryColor`** is validated to a CSS-color token before it is
  interpolated into the inline `<style>` block, closing a stored-XSS vector.
- React escapes all rendered values; the only `dangerouslySetInnerHTML` uses
  are the pre-paint theme script (static) and the validated color block.

### Authentication, authorization, roles & permissions, ✅
- Admin: accounts-only (no shared password once an admin exists), Argon2
  password hashing, optional TOTP 2FA with single-use recovery codes.
- Three roles (`monitor` < `operator` < `admin`) plus an independent
  **Traffic-data** grant; every privileged API **re-checks the account in the
  DB** each request (`requireAdmin`), so demote/delete takes effect
  immediately, not at token expiry. Destructive actions gate on
  `{ settings: true }`.
- Guest: session keyed to phone number via `requireGuestPhone`; device
  ownership re-checked per mutation.

### Session management & token expiry, ✅
- HMAC-signed cookies, `httpOnly` + `sameSite`, `secure` driven by the
  `cookieSecure` setting. TTLs: admin **12 h**, guest **24 h**, magic-link
  **20 min** (one-shot), email-verify **72 h**. All verified server-side on
  every request.

### Secrets management, ✅
- Secrets at rest (UniFi/SMTP/Cloudflare/SSH secrets, TOTP secrets) encrypted
  **AES-256-GCM** with a key derived from `ADMIN_SECRET` (`src/lib/secrets.ts`);
  never returned to the browser (blank-field-keeps-current pattern). Only
  infra bootstrap values live in `.env`.

### HTTPS / TLS / certificate rotation, ➖ (delegated)
- TLS termination and cert lifecycle are the **reverse proxy's** job, the
  bundled Traefik (Let's Encrypt via Cloudflare DNS-01, configured in the GUI,
  auto-renewing) or the operator's own proxy. The app speaks HTTP behind it
  and sets `cookieSecure` accordingly. The captive host is intentionally plain-HTTP
  (portals must work pre-Internet). Documented in README "Two-hostname setup".

### Rate limiting & abuse prevention, ✅ (see OPERATIONS for the coverage map)
- In-process token buckets (`src/lib/rateLimit.ts`) on the abuse-prone
  entry points: admin login, guest login, email verify/resend/grace. Guest
  authorize/registration is bounded by the per-phone device cap + advisory
  locks. Single-container deploy makes in-process counters correct (no shared
  store needed).

### Dependency scanning & vulnerability patching, ✅
- CI runs `npm audit --omit=dev --audit-level=critical` **before** cutting a
  release, so a critical prod-dep advisory blocks the build.

### Multi-tenancy & data isolation, 🚫 (single-tenant by design)
- One UniFi site, one org. There is no tenant dimension to isolate; adding one
  would be a rewrite, not a hardening step. `unifiSite` is a config value, not
  a tenant boundary.

---

## Data & compliance

### PII handling, retention & deletion, ✅
- Per-location retention policy (`forever` | `anonymize` after N days); a
  scheduler anonymises lapsed rows. GDPR subject export (filename = subject +
  timestamp) and erasure (which also blocks the subject's device MACs).
  Full treatment in **GDPR.md**.

### Regulatory compliance, ✅ GDPR · 🚫 HIPAA
- **GDPR**: lawful-basis notice, subject access + erasure, retention limits,
  audit trail, see GDPR.md. **HIPAA is out of scope**: this system stores no
  PHI (guest name/phone/email for WiFi access only); it must not be used for
  health data, and claiming HIPAA controls it doesn't have would be worse than
  saying so plainly.

### Audit trails & tamper-evident logging, ➖
- Every admin mutation writes an `AuditLog` row (actor, action, target,
  outcome, IP), append-only in practice, with a configurable retention window
  and CSV export. **Cryptographic tamper-evidence** (hash-chained log) is
  *not* implemented, the DB is trusted, single-host, backed up; a hash chain
  would be the next step if the threat model ever includes a compromised-DBA
  scenario. Called out honestly rather than overstated.

---

## Testing & quality

### Unit / integration / e2e, ➖
- **Unit**: pure logic (dup-IP classification, CSV escaping) on Node's
  built-in runner, **run in CI** (`npm test`). **Manual/scripted integration**:
  the setup/update scripts are exercised with pty harnesses; UniFi flows are
  smoke-tested against the live controller (STATUS.md). A full automated e2e
  browser suite is **not** present, a realistic gap for a small team; the
  highest-value pure logic is now guarded, and CI blocks a release on failure.

### Regression tests, ➖
- New pure-logic fixes land with tests (CSV guard, dup-IP). No broad
  regression suite over the UI/routes yet.

### Load / stress / chaos / resilience, 🚫 (scale-appropriate)
- One AP-site of guests on one container. Load/stress rigs and chaos
  engineering target failure modes this deployment doesn't have (no cluster,
  no autoscaler, no service mesh). The relevant resilience work, health
  checks, restart policy, disk-full protection, is done (see below).

### Test-coverage thresholds in CI, ➖
- CI runs the tests and fails on error, but does not yet enforce a coverage
  **percentage**. A threshold gate is only meaningful once the suite is broad;
  premature enforcement encourages coverage-theatre.

### Code review & standards, ✅
- All changes via PR (GitHub), Conventional Commits, TypeScript strict mode,
  ESLint.

---

## Reliability & operations

### Error handling & graceful degradation, ✅
- Admin pages are async server components with try/catch around UniFi calls,
  so the controller being unreachable renders an error banner instead of a
  crash. The alert monitor **skips** a cycle when the controller is
  unreachable rather than flapping every device to "resolved". The API-key
  fallback keeps monitoring reads alive when the cookie login breaks.

### Retry logic, backoff & idempotency, ➖
- UniFi requests retry once on 401/403 (re-login). Guest authorize/renew are
  idempotent per (phone, MAC). Systematic exponential backoff across all
  outbound calls is not implemented, the failure surfaces to the operator,
  which is acceptable for a LAN controller on the same network.

### Circuit breakers & fallback, ➖
- The controller-unreachable skip and the Integration-API read fallback are
  the pragmatic equivalents at this scale. No formal circuit-breaker library, because there is exactly one downstream (the controller) and one fallback path.

### Concurrency & race-condition prevention, ✅
- Postgres **advisory locks** (`pg_advisory_xact_lock(hashtext(phone))`)
  serialise per-phone device operations; the scheduler has a single-run guard;
  CI image builds are serialised by a concurrency group. Rate-limit buckets
  and caches are in-process (single container = no cross-node race).

### Caching & invalidation, ✅
- UniFi cookie session + dispatcher cached with TTL and explicitly cleared on
  settings change (`clearUniFiSession`). Admin pages are `force-dynamic` (no
  stale reads). No external cache layer to invalidate.

### RTO / RPO, ✅ (documented in OPERATIONS.md)
- **RPO ≤ 24 h** (nightly `pg_dump`, 14-day rotation; tighten by adding cron
  frequency). **RTO ~minutes** (`install.sh restore` + `docker compose up`). Numbers
  and the procedure live in OPERATIONS.md.

### Disaster recovery, ✅ (documented in OPERATIONS.md)
- Backup/restore scripts, the uploads volume, and the `ADMIN_SECRET`
  dependency (without it, encrypted secrets are unrecoverable, back it up)
  are the DR essentials; runbook in OPERATIONS.md.

---

## Frontend & documentation

### Accessibility, ➖
- Semantic HTML, labelled inputs, alert severity carried by **shape + aria-label**
  (not colour alone) for colourblind/screen-reader users, responsive layouts.
  No formal WCAG audit has been run, the building blocks are there; a full
  audit is the honest next step.

### Architecture diagrams & ADRs, ✅ (this doc + ROADMAP)
- This file is the architecture overview; **ROADMAP.md** records the phased
  design decisions with their rationale (the closest thing to ADRs), and each
  Phase-9 "resolve first" block documents the decision taken and why. A
  component diagram is included below.

```
LAN ──▶ host:80/443 ──▶ traefik (bundled, TLS via Cloudflare DNS-01;
                 │       config polled live from the portal)
                 │  guest hosts 403 /admin, /api/admin
                 ▼  http://portal:80 (compose bridge)
        ┌─────────────────────┐        ┌──────────────────────┐
        │ portal (Next.js 16)  │──────▶ │ Postgres (own bridge │
        │ compose service      │ Prisma │ net, not on LAN)     │
        └──────────┬───────────┘        └──────────────────────┘
                   │ classic API (cookie) + Integration API (X-API-KEY)
                   ▼
          UniFi Network Application (10.90.0.1)
```
