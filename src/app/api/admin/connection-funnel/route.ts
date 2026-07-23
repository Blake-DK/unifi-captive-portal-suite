import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { listControllerEvents } from "@/lib/unifi";
import { analyzeFunnel } from "@/lib/connectionFunnel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The onboarding funnel over the recent event window (association → auth →
 * DHCP → roaming), with per-stage failure counts and the top failing clients. */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;
  const hours = Math.min(168, Math.max(1, Number(req.nextUrl.searchParams.get("hours")) || 24));
  const events = await listControllerEvents(hours, 3000).catch(() => []);
  return NextResponse.json({ hours, ...analyzeFunnel(events) });
}
