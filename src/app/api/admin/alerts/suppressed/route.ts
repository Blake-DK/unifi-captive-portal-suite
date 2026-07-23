import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only view of the duplicate-IP suppression log — what the gate held
 * back and why, so suppression stays auditable (a genuine conflict must never
 * be hidden without a trace).
 */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const suppressed = await prisma.suppressedAlert.findMany({
    orderBy: { lastSeenAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ suppressed });
}
