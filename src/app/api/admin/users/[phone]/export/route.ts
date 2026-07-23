import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { exportDataSubject } from "@/lib/dataSubject";

export const runtime = "nodejs";

/**
 * Subject Access Request (GDPR Art. 15) export: a machine-readable bundle of
 * everything the app holds about the data subject (all registrations + audit
 * references), downloaded as JSON. Audited.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ phone: string }> }) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const phone = decodeURIComponent((await params).phone);
  const bundle = await exportDataSubject(phone);
  if (bundle.counts.registrations === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  audit(req, { actorType: "admin", actor: session.sub, action: "guest.export", target: phone });

  // Filename = the subject's name + the export date/time, e.g.
  // "John-Doe-2026-07-06-213524.json" (falls back to phone digits if the name
  // has been anonymised away). Timestamp is UTC to the second.
  const reg = bundle.registrations[0] as { firstName?: string; lastName?: string } | undefined;
  const namePart =
    [reg?.firstName, reg?.lastName].filter(Boolean).join("-") ||
    phone.replace(/[^0-9]/g, "") ||
    "subject";
  const safeName = namePart.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const stamp = new Date().toISOString().slice(0, 19).replace("T", "-").replace(/:/g, "");
  const filename = `${safeName}-${stamp}.json`;
  return new NextResponse(JSON.stringify(bundle, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
