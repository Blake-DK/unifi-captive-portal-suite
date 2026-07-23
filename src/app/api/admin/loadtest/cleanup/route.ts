import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { cleanupController } from "@/lib/loadTest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Revoke every fake load-test MAC still authorized on the controller and drop
 * the matching guest rows. Uses the portal's own UniFi session. Idempotent.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  try {
    const result = await cleanupController();
    audit(req, {
      actorType: "admin",
      actor: session.sub,
      action: "loadtest.cleanup",
      detail: result,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cleanup failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
