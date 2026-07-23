# GDPR / Data Protection Plan

**Status:** working compliance plan for the guest-WiFi captive portal.
**Last updated:** 2026-07-04.

> **Not legal advice.** This document is an engineering-maintained record of
> what personal data the system processes, how, and the controls around it. It
> is a starting point for compliance, not a certificate of it. The operating
> organisation (the **data controller**) must have this reviewed by its DPO /
> legal function, confirm the lawful bases and retention periods against its own
> obligations, and publish a guest-facing privacy notice. Nothing here creates a
> legal guarantee.

## 1. Roles

- **Data controller:** the organisation operating this portal and network (sets
  the purposes and means of processing; owns the guest relationship).
- **Processors (sub-processors) engaged by the system:**
  - **SMTP provider**: currently smtp2go (EU region), transmits verification,
    expiry, and alert emails (recipient address + message content).
  - **Reverse proxy**: the bundled Traefik container on the same host (or
    the operator's own proxy), terminates TLS and forwards guest/admin HTTP;
    sees request metadata and, at the TLS edge, traffic. Certificate issuance
    shares the hostname with **Let's Encrypt / Cloudflare** (DNS-01).
  - **Ubiquiti UniFi controller / gateway**: on-network; holds MAC addresses,
    session records, and DPI application/category data.
  - Self-hosted infrastructure (this container + PostgreSQL) is operated by the
    controller directly, not a third party.
- A **processing agreement (DPA)** should be on file with each external
  processor, and international-transfer safeguards checked (smtp2go EU keeps
  mail data in-region; confirm the VPS host's location and terms).

## 2. Lawful basis (to be confirmed by the controller)

| Processing | Suggested basis | Notes |
|---|---|---|
| Granting and managing network access (registration, device auth, expiry) | **Contract** (Art. 6(1)(b)), providing the requested WiFi service | Name, phone, MAC, device/session data |
| Email verification | **Contract / legitimate interest** | Confirms a reachable address, reduces abuse |
| Security, abuse prevention, audit logging | **Legitimate interest** (Art. 6(1)(f)) | Requires a documented balancing test |
| Traffic categorisation (DPI app/category, not content) | **Legitimate interest** | Disclosed in the terms; see §7 and the DPIA note |
| Expiry / alert notifications | **Legitimate interest / contract** | Alerts are about network devices, not guests |

The terms-of-use acceptance at registration records agreement to the terms and
the data-handling disclosure; it is **not** by itself the GDPR lawful basis for
service processing (that is contract). Keep consent and contract distinct.

## 3. Record of Processing Activities (ROPA), personal data inventory

Source of truth: `prisma/schema.prisma`. Personal data actually stored:

| Store / model | Personal data | Purpose | Retention |
|---|---|---|---|
| `GuestRegistration` | first/last name, phone, email, optional CPF, MAC, AP MAC, SSID, IP address, user-agent, location/building/room, byte counters, timestamps, device label | Provide + manage network access; per-guest usage/troubleshooting | Per-location retention policy: *keep forever* or *anonymize N days after expiry/revocation* (hourly job). Anonymisation scrubs identifying fields **but deliberately keeps the MAC**: see §8 gap. |
| `AuditLog` | admin username / guest phone, action, target (MAC/phone/username/path), IP, timestamp | Security, accountability, breach investigation | `auditRetentionDays` window (0 = keep forever), **set a finite window**. |
| `AdminUser` | username, password hash (bcrypt/argon), TOTP secret, last-login | Admin authentication | Life of the account; deleted on account removal |
| `Voucher` / `Event` | created-by admin username; links to registrations | Access issuance, event tracking | With the record; event CSV export contains guest PII |
| UniFi controller (processor) | MAC, session history, DPI app/category | Network operation | Controller-side retention (**not** governed by this app's job) |
| Email provider (processor) | recipient address, message content | Delivery | Provider retention / logs |

**Special-category data:** none is intentionally collected. CPF (a national ID)
is high-sensitivity where used, collect only if a lawful requirement exists,
and treat it as elevated-risk PII.

## 4. Data minimisation

- The registration form should collect only fields the deployment actually
  needs. Email is required only when verification is enabled; CPF, building, and
  room are optional/location-driven. Review each field against necessity.
- DPI is **application/category only**: not URLs, DNS, or content, and is
  visible only to admins holding the `canViewTraffic` grant. Per-user browsing
  surveillance is explicitly out of scope and would need its own basis, DPIA,
  and disclosure before any UI is built.

## 5. Retention & erasure

**Built:**
- Per-location retention policy (keep vs anonymize after N days), a global
  default for location-less rows, and an audit-log retention window, applied by
  an hourly in-process job (`retention.run` audit trail).

**Built:**
- **Right-to-erasure action** (a guest's admin page → *Erase & forget*,
  full-admin only): blocks every device MAC the subject used (UniFi block-sta: disconnect + refuse reconnection, recorded as a blocked device with reason
  "Blocked on GDPR data request", so their gear can't quietly rejoin), deletes
  all the subject's registration rows, and pseudonymises their identifier in the
  audit log, then surfaces a reminder listing the MACs to scrub controller-side.
  Audited `guest.erase`.

**Gaps / actions:**
- **Set finite retention** in production (defaults are "keep forever"). Choose
  periods per the controller's policy and document them here. *(Retention is
  now a preset selector in the admin UI, the value is still a policy choice.)*
- Erasure is **DB-side only**: it does not reach the UniFi controller's MAC/
  session/DPI history or the mail provider's logs. The action flags the manual
  controller-side step; treat that step as part of the documented procedure.

## 6. Data subject rights, current handling

| Right | Today | Gap |
|---|---|---|
| **Access (SAR)** | Guest self-service shows their devices/profile; admin *Export data (SAR)* downloads a machine-readable JSON bundle of all registrations + audit references held | Controller/mail-provider data is out of band |
| **Rectification** | Guest can edit profile; admin can edit records | OK |
| **Erasure** | Admin *Erase & forget* blocks the subject's device MACs (reason "GDPR data request"), deletes the subject, and pseudonymises the audit log in one action (see §5) | Controller-side MAC/session/DPI scrub is still manual (flagged by the action) |
| **Restriction / objection** | Revoke access; manual | No self-serve objection flow |
| **Portability** | Admin CSV (users, event) + per-subject JSON SAR export | No guest-initiated (self-serve) export |
| **Automated decisions** | None (no profiling/automated decisions with legal effect) | N/A |

A documented **response procedure and SLA** (identity check, locate all records
across DB + controller + mail logs, respond within one month) should exist even
before the tooling is automated.

## 7. Transparency & consent

- **Terms of use** are shown and accepted at registration and include a
  traffic-categorisation disclosure (application/category, admin-only).
- **Guest-facing privacy notice** is published at `/portal/privacy` (linked
  from the sign-in form). It renders a controller-authored notice (Settings →
  Portal) or a built-in template covering what is collected, why, retention,
  processors, and rights, plus a rights-request contact. **Action for the
  controller:** review/complete the notice content (identity, lawful bases,
  concrete retention periods, transfers, DPO contact), the template is a
  starting point, not a legal sign-off.

## 8. Security (technical & organisational measures)

**In place:**
- TLS in transit for guest self-service and admin (HTTPS via Traefik); the
  captive host stays HTTP-only by design for captive-portal detection.
- Admin access control: per-person accounts, least-privilege roles
  (admin/operator/monitor), a separate traffic-data grant, TOTP 2FA, rate-
  limited logins, and a full audit trail.
- Admin-path firewalling at the proxy (guests cannot reach `/admin` on the
  guest hostnames); device SSH tooling is full-admin-only and audited.
- Passwords hashed; migrations and CI-built images; single-tenant self-hosted DB.

**Gaps / actions:**
- **Secrets at rest are plaintext in the DB** (SMTP/API/SSH passwords, TOTP
  secrets). Consider encryption-at-rest for the DB volume and/or application-
  level encryption of secret columns. Document disk-level protections.
- **MAC retained after anonymisation**: a MAC is personal data (a device
  identifier). Justify (needed to key controller auth/history) in the balancing
  test, or add true erasure. This is the single most notable compliance gap.
- Backups: define what DB backups exist, their retention, and how erasure
  propagates to them.

## 9. International transfers

- smtp2go EU keeps mail data in the EU (confirm the account region). If any
  processor stores data outside the EEA/UK, ensure an adequacy decision or SCCs
  are in place and record them here.

## 10. DPIA (screening)

The processing involves systematic collection of identifiers on a network plus
DPI categorisation. A **DPIA is advisable** (arguably required if monitoring is
"systematic and extensive"). Key risks to assess: retention creep,
re-identification via retained MAC, scope creep of DPI toward content, and admin
over-access. Record the DPIA outcome and mitigations alongside this file.

## 11. Personal-data-breach procedure

- **Detect:** the audit trail and (new) network alerting surface anomalous
  admin actions and outages. Access to secrets/PII is admin-gated and logged.
- **Contain & assess:** revoke affected admin accounts (deletion invalidates
  sessions), rotate exposed secrets, scope the affected data subjects from the
  audit log.
- **Notify:** the controller must notify the supervisory authority within
  **72 hours** of becoming aware of a reportable breach, and affected data
  subjects if high risk. Keep an internal breach register.
- Document the on-call contact and escalation path (owned by the controller).

## 12. Compliance backlog (engineering + operational)

Prioritised; the code items also live in the session planning notes.

1. ✅ **Privacy notice built** (`/portal/privacy`, linked from the form,
   controller-editable). *Remaining (policy):* record lawful bases + concrete
   retention periods in the notice and this file.
2. **Set finite retention** in production (`defaultRetention*`, per-location,
   `auditRetentionDays`) instead of "keep forever". *(config; retention is now
   a preset selector in the UI, pick the values)*
3. ✅ **Right-to-erasure action built** (*Erase & forget*: deletes the subject
   across `GuestRegistration`, pseudonymises audit references, flags the manual
   controller-side MAC/session/DPI scrub).
4. ✅ **SAR export built** (per-subject JSON of all registrations + audit
   references, audited).
5. **Reconsider MAC retention** on anonymisation, or document the §8 balancing
   test. *(policy or build)*
6. **Secrets at rest**: encrypt secret columns or the DB volume; document.
   *(build / infra)*
7. **DPAs + DPIA on file**; confirm processor regions/transfers. *(operational)*
8. **Breach register + response runbook** with named contacts. *(operational)*
