import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { getMailSettings } from "@/lib/mailer";
import { testM365Connection } from "@/lib/m365Mail";

export const runtime = "nodejs";

/**
 * Token-acquisition probe for the SAVED Microsoft 365 credentials. A pass
 * proves tenant/client/secret; mailbox and ApplicationAccessPolicy problems
 * only surface on a real send — the UI says to follow with "Send test email".
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const mail = await getMailSettings();
  if (!mail || !mail.m365TenantId || !mail.m365ClientId || !mail.m365ClientSecret || !mail.m365Sender) {
    return NextResponse.json(
      { error: "Save the tenant ID, client ID, client secret, and sender mailbox first." },
      { status: 400 },
    );
  }

  const result = await testM365Connection({
    tenantId: mail.m365TenantId,
    clientId: mail.m365ClientId,
    clientSecret: mail.m365ClientSecret,
    sender: mail.m365Sender,
  });

  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "settings.m365_check",
    target: mail.m365Sender,
    outcome: result.ok ? "success" : "failure",
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true });
}
