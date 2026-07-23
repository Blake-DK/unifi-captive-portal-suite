import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { clientIp } from "./rateLimit";
import { chainHashOf } from "./auditChain";
import { renderSyslogLine, sendSyslog } from "./auditSyslog";

/**
 * Append-only audit trail: who did what, when — admin actions, guest
 * self-service mutations, logins, permission denials, and traffic-data
 * lookups. Viewable at /admin/audit (full admins only).
 *
 * Action names are dot-namespaced (`account.create`, `guest.revoke`,
 * `traffic.site_view`); `detail` carries small structured context (changed
 * field names, MACs, labels) but never secret values.
 *
 * Every row is hash-chained (see auditChain.ts): the insert reads the tip
 * inside a transaction serialized by an advisory lock, so concurrent writers
 * cannot fork the chain, and the verify action on /admin/audit can prove no
 * stored row was silently edited or deleted.
 */

export type AuditEntry = {
  actorType: "admin" | "guest" | "system";
  /** Admin username (or "setup") / guest phone digits / system component name. */
  actor: string;
  action: string;
  target?: string | null;
  detail?: Record<string, unknown> | null;
  outcome?: "success" | "denied" | "failure";
};

// Advisory-lock key for chain appends ("AUDT"); pg_advisory_xact_lock
// releases it with the transaction.
const CHAIN_LOCK_KEY = 0x41554454;

// Syslog target, cached briefly — audit writes are frequent and the
// settings row changes rarely.
let syslogCache: { at: number; host: string; port: number } | null = null;
async function syslogTarget(): Promise<{ host: string; port: number } | null> {
  if (syslogCache && Date.now() - syslogCache.at < 60_000) {
    return syslogCache.host ? syslogCache : null;
  }
  const s = await prisma.systemSettings
    .findUnique({
      where: { id: "config" },
      select: { syslogEnabled: true, syslogHost: true, syslogPort: true },
    })
    .catch(() => null);
  syslogCache = {
    at: Date.now(),
    host: s?.syslogEnabled && s.syslogHost.trim() ? s.syslogHost.trim() : "",
    port: s?.syslogPort || 514,
  };
  return syslogCache.host ? syslogCache : null;
}

async function chainedInsert(entry: AuditEntry, ip: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Serialize appends: two writers reading the same tip would fork the
    // chain, and every later verify would report a false break.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CHAIN_LOCK_KEY})`;
    const prev = await tx.auditLog.findFirst({
      orderBy: { id: "desc" },
      select: { chainHash: true },
    });
    // createdAt is set here (not by the DB default) so the hashed value is
    // exactly what the row stores.
    const row = {
      createdAt: new Date(),
      actorType: entry.actorType,
      actor: entry.actor,
      action: entry.action,
      target: entry.target ?? null,
      detail: entry.detail ?? null,
      ip,
      outcome: entry.outcome ?? "success",
    };
    await tx.auditLog.create({
      data: {
        ...row,
        detail: (entry.detail ?? undefined) as Prisma.InputJsonValue | undefined,
        chainHash: chainHashOf(prev?.chainHash ?? null, row),
      },
    });
    return row;
  }).then(async (row) => {
    // SIEM forwarding, best-effort and after the row is committed.
    const target = await syslogTarget();
    if (target) sendSyslog(renderSyslogLine(row), target.host, target.port);
  });
}

// Chain appends already serialize ACROSS processes on the advisory lock;
// this in-process FIFO keeps concurrent appends from each parking a pooled
// connection while they wait for that lock. A registration burst used to
// fill the whole pool with queued audit transactions and starve the request
// path. Now at most one audit write holds a connection at a time.
let auditChainTail: Promise<void> = Promise.resolve();
let auditQueueDepth = 0;
const AUDIT_QUEUE_MAX = 10_000;

function enqueueChainedInsert(entry: AuditEntry, ip: string | null): Promise<void> {
  if (auditQueueDepth >= AUDIT_QUEUE_MAX) {
    // Fire-and-forget semantics: dropping an entry beats unbounded memory
    // growth while the database is down under sustained traffic.
    return Promise.reject(new Error(`audit queue full (${AUDIT_QUEUE_MAX} pending)`));
  }
  auditQueueDepth++;
  const run = auditChainTail.then(() => chainedInsert(entry, ip));
  auditChainTail = run
    .catch(() => {}) // one failed write must not poison the chain
    .finally(() => {
      auditQueueDepth--;
    });
  return run;
}

/**
 * Fire-and-forget by design: an audit-write failure must never turn a
 * successful operation into a 500 (the operation has already happened).
 * Failures land in the container log instead.
 */
export function audit(req: NextRequest, entry: AuditEntry): void {
  enqueueChainedInsert(entry, clientIp(req) ?? null).catch((err) => {
    console.error(`Audit write failed (${entry.action} by ${entry.actor}):`, err);
  });
}

/**
 * The same chained write for schedulers and system components with no
 * request in hand. Awaitable, but never throws — failures are logged like
 * audit()'s.
 */
export async function auditSystem(entry: AuditEntry): Promise<void> {
  try {
    await enqueueChainedInsert(entry, null);
  } catch (err) {
    console.error(`Audit write failed (${entry.action} by ${entry.actor}):`, err);
  }
}
