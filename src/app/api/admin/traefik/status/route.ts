import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { runProxyChecks } from "@/lib/traefikTest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Test button on Settings → URLs → Reverse Proxy: live probes through
 * Traefik (routing, admin blocking, certificates, config polling). Read-only
 * and side-effect-free, so plain admin auth suffices.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;
  return NextResponse.json(await runProxyChecks());
}
