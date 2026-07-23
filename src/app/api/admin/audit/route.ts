import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toCSV } from "@/lib/csv";
import { requireAdmin } from "@/lib/adminGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Audit trail — full admins only (it exposes admin activity, login failures
 * and traffic-lookup history, which operators/monitors have no business
 * reading). Read-only: rows are written via src/lib/audit.ts, never edited.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim() ?? "";
  const action = sp.get("action")?.trim() ?? "";
  const outcome = sp.get("outcome")?.trim() ?? "";
  const from = sp.get("from");
  const to = sp.get("to");
  const format = sp.get("format");
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const pageSize = Math.min(500, Math.max(1, parseInt(sp.get("pageSize") ?? "25", 10)));

  const where: Prisma.AuditLogWhereInput = {};
  if (q) {
    where.OR = [
      { actor: { contains: q, mode: "insensitive" } },
      { target: { contains: q, mode: "insensitive" } },
    ];
  }
  // Prefix match so "guest" finds guest.revoke, guest.device_add, …
  if (action) where.action = { startsWith: action };
  if (outcome) where.outcome = outcome;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(`${from}T00:00:00`);
    if (to) where.createdAt.lte = new Date(`${to}T23:59:59`);
  }

  if (format === "csv") {
    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 10000,
    });
    const csv = toCSV(
      rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        actorType: r.actorType,
        actor: r.actor,
        action: r.action,
        target: r.target ?? "",
        outcome: r.outcome,
        ip: r.ip ?? "",
        detail: r.detail === null ? "" : JSON.stringify(r.detail),
      })),
      [
        { key: "id", header: "ID" },
        { key: "createdAt", header: "Time" },
        { key: "actorType", header: "Actor Type" },
        { key: "actor", header: "Actor" },
        { key: "action", header: "Action" },
        { key: "target", header: "Target" },
        { key: "outcome", header: "Outcome" },
        { key: "ip", header: "IP" },
        { key: "detail", header: "Detail" },
      ],
    );
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="audit-${Date.now()}.csv"`,
      },
    });
  }

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({ total, rows, page, pageSize });
}
