import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { runSystemHealth } from "@/lib/systemHealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Feeds the System Health panel at the bottom of Settings → URLs: container
 * state (published by the traefik-ops sidecar into the shared ./traefik
 * mount) plus live guest/admin separation checks. Read-only and
 * side-effect-free, so plain admin auth suffices — same stance as
 * /api/admin/traefik/status.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;
  return NextResponse.json(await runSystemHealth());
}
