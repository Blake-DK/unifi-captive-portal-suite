import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { eraseDataSubject } from "@/lib/dataSubject";

export const runtime = "nodejs";

/**
 * Right-to-erasure (GDPR Art. 17): block every device MAC the subject used
 * (disconnect + refuse reconnection, recorded as blocked on a GDPR request),
 * delete all their registration rows, and pseudonymise their identifier in the
 * audit log. Full-admin only; audited. UniFi's own MAC/session/DPI history is
 * out of this app's reach, so the response flags the manual controller-side scrub.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ phone: string }> }) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const phone = decodeURIComponent((await params).phone);
  const result = await eraseDataSubject(phone, session.sub);
  if (!result) return NextResponse.json({ error: "User not found" }, { status: 404 });

  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "guest.erase",
    target: phone,
    detail: {
      deleted: result.deleted,
      auditPseudonymised: result.auditPseudonymised,
      blocked: result.blocked,
      unifiFailed: result.unifiFailed,
    },
  });

  const failedNote = result.unifiFailed.length
    ? ` NOTE: the controller block failed for ${result.unifiFailed.join(", ")} — block these manually.`
    : "";

  return NextResponse.json({
    ok: true,
    ...result,
    // Reminder surfaced to the operator: the devices are now blocked, but the
    // erasure of retained history is still DB-side only here.
    manualScrub:
      `${result.blocked.length} device(s) blocked on the controller (reason: GDPR data request). ` +
      "UniFi still retains MAC / session / DPI history for them independently — " +
      "complete the erasure by removing that history on the controller for: " +
      result.macs.join(", ") +
      failedNote,
  });
}
