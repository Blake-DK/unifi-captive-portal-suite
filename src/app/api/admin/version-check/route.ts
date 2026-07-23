import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { getVersionStatus } from "@/lib/updateCheck";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Check now" for the Monitoring settings card — forces a cache refresh. */
export async function POST(req: NextRequest) {
  const { error } = await requireAdmin(req, { settings: true });
  if (error) return error;
  return NextResponse.json(await getVersionStatus(true));
}
