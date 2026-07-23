import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { jsonSafe } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Recent run history, newest first (for the "last run" card + resume-polling). */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const runs = await prisma.loadTestRun.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return NextResponse.json(jsonSafe({ runs }));
}
