import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Full list of currently-blocked devices, for client-rendered pages (e.g. Alerts). */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const rows = await prisma.blockedDevice.findMany({ orderBy: { blockedAt: "desc" } });
  return NextResponse.json({ blocked: rows });
}
