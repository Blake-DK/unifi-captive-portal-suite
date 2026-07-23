import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { deviceHostForMac, getSshCredentials, openShell } from "@/lib/deviceSsh";
import { createSession } from "@/lib/sshSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Open an interactive SSH shell and return its session id. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ mac: string }> }) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const creds = await getSshCredentials();
  if (creds.length === 0) {
    return NextResponse.json({ error: "Set device SSH credentials in Settings → Monitoring first" }, { status: 400 });
  }
  const { mac } = await ctx.params;
  const host = await deviceHostForMac(decodeURIComponent(mac));
  if (!host) return NextResponse.json({ error: "Unknown or offline device" }, { status: 404 });

  try {
    const { conn, stream } = await openShell(host.ip, creds);
    const ssh = createSession(session.sub, host.name, conn, stream);
    audit(req, {
      actorType: "admin",
      actor: session.sub,
      action: "device.terminal",
      target: host.name,
      detail: { ip: host.ip, event: "open" },
    });
    return NextResponse.json({ session: ssh.id, device: host.name });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "SSH failed" }, { status: 502 });
  }
}
