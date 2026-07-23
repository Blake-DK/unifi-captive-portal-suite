import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Send-activity feed for Settings → Email: last 25 attempts + 7-day counts. */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [recent, grouped] = await Promise.all([
    prisma.emailLog.findMany({ orderBy: { createdAt: "desc" }, take: 25 }),
    prisma.emailLog.groupBy({
      by: ["kind", "ok"],
      _count: true,
      where: { createdAt: { gte: sevenDaysAgo } },
    }),
  ]);

  const counts: Record<string, number> = { verify: 0, expiry: 0, alert: 0, test: 0, failures: 0 };
  for (const g of grouped) {
    counts[g.kind] = (counts[g.kind] ?? 0) + g._count;
    if (!g.ok) counts.failures += g._count;
  }

  return NextResponse.json({ recent, counts });
}
