import { prisma } from "./prisma";
import { canonicalizeMac } from "./mac";
import { blockStation } from "./unifi";

/**
 * GDPR data-subject operations keyed by a guest's phone (the account key).
 *
 * - `exportDataSubject` gathers everything the app holds about the subject for
 *   a Subject Access Request (SAR): every registration row plus the audit-log
 *   entries that reference them.
 * - `eraseDataSubject` is the right-to-erasure action: it blocks every device
 *   MAC the subject used (UniFi block-sta — disconnects and refuses
 *   reconnection — recorded as a blocked device so it can't quietly come back),
 *   deletes all registration rows, and pseudonymises the subject's identifier
 *   in the audit log (so the accountability trail of *actions* survives without
 *   the personal identifier). It returns the MACs involved so the caller can
 *   flag the manual controller-side scrub (UniFi keeps its own MAC / session /
 *   DPI history that this app cannot reach).
 */

const TOMBSTONE = "erased";
const GDPR_BLOCK_REASON = "Blocked on GDPR data request";

/** BigInt fields (byte counters) aren't JSON-serialisable — stringify them. */
function serialisable(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === "bigint" ? v.toString() : v;
  return out;
}

export async function exportDataSubject(phone: string) {
  const registrations = await prisma.guestRegistration.findMany({
    where: { phone },
    orderBy: { authorizedAt: "asc" },
  });
  const auditReferences = await prisma.auditLog.findMany({
    where: {
      OR: [{ actorType: "guest", actor: phone }, { target: phone }],
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    exportedAt: new Date().toISOString(),
    subject: { phone },
    counts: { registrations: registrations.length, auditReferences: auditReferences.length },
    registrations: registrations.map((r) => serialisable(r as unknown as Record<string, unknown>)),
    auditReferences: auditReferences.map((a) => serialisable(a as unknown as Record<string, unknown>)),
  };
}

export type EraseResult = {
  deleted: number;
  blocked: string[]; // MACs blocked on the controller + recorded as blocked devices
  unifiFailed: string[]; // MACs the controller block call failed for (need manual follow-up)
  auditPseudonymised: number;
  macs: string[];
};

export async function eraseDataSubject(
  phone: string,
  blockedBy: string,
): Promise<EraseResult | null> {
  const rows = await prisma.guestRegistration.findMany({ where: { phone } });
  if (rows.length === 0) return null;

  // Every distinct device the subject ever registered — canonicalised so the
  // block record matches the format used everywhere else (manual block route,
  // blocked-devices list).
  const macs = [...new Set(rows.map((r) => canonicalizeMac(r.macAddress) ?? r.macAddress.toLowerCase()))];

  // Block each MAC (not just the currently-active ones): disconnect and refuse
  // reconnection, and record it as a blocked device so an erased subject's gear
  // can't quietly rejoin. Best-effort per the controller — a failed block is
  // reported for manual follow-up and does not leave a misleading DB record.
  const blocked: string[] = [];
  const unifiFailed: string[] = [];
  for (const mac of macs) {
    try {
      await blockStation(mac);
      await prisma.blockedDevice.upsert({
        where: { mac },
        create: { mac, reason: GDPR_BLOCK_REASON, blockedBy },
        update: { reason: GDPR_BLOCK_REASON, blockedBy, blockedAt: new Date() },
      });
      blocked.push(mac);
    } catch {
      unifiFailed.push(mac);
    }
  }

  const { count: deleted } = await prisma.guestRegistration.deleteMany({ where: { phone } });

  // Pseudonymise the subject's identifier in the audit trail: keep the record
  // of what happened, drop the personal identifier.
  const [byActor, byTarget] = await Promise.all([
    prisma.auditLog.updateMany({
      where: { actorType: "guest", actor: phone },
      data: { actor: TOMBSTONE },
    }),
    prisma.auditLog.updateMany({ where: { target: phone }, data: { target: TOMBSTONE } }),
  ]);

  return {
    deleted,
    blocked,
    unifiFailed,
    auditPseudonymised: byActor.count + byTarget.count,
    macs,
  };
}
