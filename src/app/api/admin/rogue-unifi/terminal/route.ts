import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { getSshCredentials, openShell } from "@/lib/deviceSsh";
import { createSession } from "@/lib/sshSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Interactive shell to an UN-ADOPTED device, addressed by IP (there is no
 * controller record to resolve a MAC against). With no credentials in the
 * body the saved ones are tried in order; supplying username/password lets
 * the operator try a one-off login without storing it.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const ip = typeof body.ip === "string" ? body.ip.trim() : "";
  if (!/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(ip)) {
    return NextResponse.json({ error: "A device IP address is required" }, { status: 400 });
  }
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const port = Math.min(65535, Math.max(1, Math.round(Number(body.port)) || 22));

  const creds = username && password ? [{ username, password, port }] : await getSshCredentials();
  if (creds.length === 0) {
    return NextResponse.json(
      { error: "No SSH credentials — set them in Settings → Monitoring, or type a username and password here." },
      { status: 400 },
    );
  }

  try {
    const { conn, stream } = await openShell(ip, creds);
    const ssh = createSession(session.sub, ip, conn, stream);
    audit(req, {
      actorType: "admin",
      actor: session.sub,
      action: "rogue.unifi.terminal",
      target: ip,
      // Never the password; the username only when the operator typed one.
      detail: { event: "open", ...(username ? { username } : { credentials: "saved" }) },
    });
    return NextResponse.json({ session: ssh.id, device: ip });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "SSH connection failed" },
      { status: 502 },
    );
  }
}
