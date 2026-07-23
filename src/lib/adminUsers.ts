import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { isRegistrationActive, latestPerMac } from "./guestDevices";

export type AdminUserRow = {
  phone: string;
  firstName: string;
  lastName: string;
  email: string | null;
  lastAuthorizedAt: Date;
  activeDeviceCount: number;
};

type RawRow = {
  phone: string;
  firstName: string;
  lastName: string;
  email: string | null;
  lastAuthorizedAt: Date;
};

/**
 * Users aren't a table — a "user" is the set of GuestRegistration rows
 * sharing a phone number. Grouping/pagination is done in SQL (DISTINCT ON)
 * rather than fetched-then-reduced in JS: reducing in JS would require
 * pulling every matching row into memory before dedup, which breaks
 * SQL-level pagination/count and gets worse as the table grows. The search
 * filter is applied to the underlying rows (so a guest found via an old
 * name on a historical row is still found), then DISTINCT ON picks that
 * phone's latest row for display — filter-before-dedupe is what makes
 * "search matches history, display shows current info" work correctly.
 */
export async function listUsersPage(opts: {
  q?: string;
  page: number;
  pageSize: number;
}): Promise<{ rows: AdminUserRow[]; total: number }> {
  const search = opts.q?.trim();
  // Anonymized rows are excluded everywhere — they no longer represent a person.
  const whereSql = search
    ? Prisma.sql`WHERE "anonymizedAt" IS NULL AND ("phone" ILIKE ${"%" + search + "%"} OR "firstName" ILIKE ${"%" + search + "%"} OR "lastName" ILIKE ${"%" + search + "%"} OR "email" ILIKE ${"%" + search + "%"})`
    : Prisma.sql`WHERE "anonymizedAt" IS NULL`;

  const rows = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
    SELECT * FROM (
      SELECT DISTINCT ON ("phone") "phone", "firstName", "lastName", "email", "authorizedAt" AS "lastAuthorizedAt"
      FROM "GuestRegistration"
      ${whereSql}
      ORDER BY "phone", "authorizedAt" DESC
    ) t
    ORDER BY t."lastAuthorizedAt" DESC
    LIMIT ${opts.pageSize} OFFSET ${(opts.page - 1) * opts.pageSize}
  `);

  const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
    SELECT COUNT(*) AS count FROM (
      SELECT DISTINCT "phone" FROM "GuestRegistration" ${whereSql}
    ) t
  `);

  // Distinct currently-active MACs per phone (same semantics as the detail
  // page's "Devices (N)") — not raw registration rows, which also count
  // expired authorizations and per-MAC re-registration history.
  const phones = rows.map((r) => r.phone);
  const deviceRows = phones.length
    ? await prisma.guestRegistration.findMany({
        where: { phone: { in: phones }, revokedAt: null, anonymizedAt: null },
        orderBy: { authorizedAt: "desc" },
        select: {
          phone: true,
          macAddress: true,
          revokedAt: true,
          authorizedAt: true,
          durationMin: true,
        },
      })
    : [];
  const rowsByPhone = new Map<string, typeof deviceRows>();
  for (const r of deviceRows) {
    const list = rowsByPhone.get(r.phone);
    if (list) list.push(r);
    else rowsByPhone.set(r.phone, [r]);
  }
  const countByPhone = new Map(
    [...rowsByPhone.entries()].map(([phone, list]) => [
      phone,
      latestPerMac(list).filter((r) => isRegistrationActive(r)).length,
    ]),
  );

  return {
    rows: rows.map((r) => ({ ...r, activeDeviceCount: countByPhone.get(r.phone) ?? 0 })),
    total: Number(count),
  };
}
