import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type RetentionStats = {
  ranAt: string;
  durationMs: number;
  scannedRegistrations: number;
  anonymized: number;
  purgedAuditLogs: number;
  purgedEmailLogs: number;
};

const BATCH_LIMIT = 500;

let inFlight: Promise<RetentionStats> | null = null;

/**
 * Applies the data-retention policy: anonymizes guest registrations whose
 * location (or, for rows without one, the global default) says "anonymize"
 * once they are N days past expiry/revocation, and prunes AuditLog rows
 * older than the global audit window. Active and never-expiring rows are
 * never touched. Bounded per run; the hourly scheduler catches up.
 *
 * Concurrent callers (scheduler tick + manual "Run now") share one run.
 */
export function runRetention(): Promise<RetentionStats> {
  if (inFlight) return inFlight;
  inFlight = doRun().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doRun(): Promise<RetentionStats> {
  const startedAt = Date.now();
  const settings = await prisma.systemSettings.findUnique({ where: { id: "config" } });
  const locations = await prisma.location.findMany({
    select: { id: true, retentionMode: true, retentionDays: true },
  });
  const policyByLocation = new Map(locations.map((l) => [l.id, l]));
  const defaultPolicy = {
    retentionMode: settings?.defaultRetentionMode ?? "forever",
    retentionDays: settings?.defaultRetentionDays ?? 0,
  };

  // Due-ness (revokedAt, or authorizedAt + durationMin) is computed in JS —
  // same semantics as isRegistrationActive() — since Postgres can't use an
  // index on that expression without a generated column.
  const candidates = await prisma.guestRegistration.findMany({
    where: {
      anonymizedAt: null,
      OR: [{ revokedAt: { not: null } }, { durationMin: { gt: 0 } }],
    },
    select: { id: true, locationId: true, revokedAt: true, authorizedAt: true, durationMin: true },
    orderBy: { authorizedAt: "asc" },
    take: BATCH_LIMIT,
  });

  const now = Date.now();
  const toAnonymize = candidates.filter((r) => {
    const dueAt =
      r.revokedAt?.getTime() ??
      (r.durationMin > 0 ? r.authorizedAt.getTime() + r.durationMin * 60_000 : null);
    if (dueAt == null || dueAt > now) return false; // active or never-expiring
    const policy = r.locationId != null ? policyByLocation.get(r.locationId) : defaultPolicy;
    if (!policy || policy.retentionMode !== "anonymize") return false;
    return now - dueAt >= policy.retentionDays * 86_400_000;
  });

  if (toAnonymize.length > 0) {
    await prisma.$transaction(
      toAnonymize.map((r) =>
        prisma.guestRegistration.update({
          where: { id: r.id },
          data: {
            firstName: "Anonymized",
            lastName: "",
            email: null,
            cpf: null,
            ipAddress: null,
            userAgent: null,
            label: null,
            locationName: null,
            // Non-reversible placeholder; also removes the row from the
            // phone-keyed users directory and self-service login.
            phone: `anon-${r.id}`,
            anonymizedAt: new Date(),
          },
        }),
      ),
    );
  }

  let purgedAuditLogs = 0;
  let purgedEmailLogs = 0;
  const auditDays = settings?.auditRetentionDays ?? 0;
  if (auditDays > 0) {
    const cutoff = new Date(now - auditDays * 86_400_000);
    const res = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    purgedAuditLogs = res.count;
    // EmailLog rides the same knob — it carries guest addresses, so it gets
    // the same lifetime as the audit trail.
    const mails = await prisma.emailLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    purgedEmailLogs = mails.count;
  }

  const stats: RetentionStats = {
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    scannedRegistrations: candidates.length,
    anonymized: toAnonymize.length,
    purgedAuditLogs,
    purgedEmailLogs,
  };

  await prisma.systemSettings
    .update({
      where: { id: "config" },
      data: {
        lastRetentionRunAt: new Date(),
        lastRetentionStats: stats as unknown as Prisma.InputJsonValue,
      },
    })
    .catch((err) => console.error("Failed to record retention stats:", err));

  return stats;
}
