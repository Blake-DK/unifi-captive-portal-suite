import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { closeSession, getSession, resizeSession, waitForOutput, writeSession } from "@/lib/sshSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Session transport for the un-adopted-device terminal — same long-poll shape
 * as the adopted-device route (GET drains output, POST writes keystrokes or a
 * resize, DELETE closes). Sessions are owner-scoped, so an admin can only ever
 * touch the ones they opened.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ session: string }> }) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;
  const { session: id } = await ctx.params;
  const ssh = getSession(id, session.sub);
  if (!ssh) return NextResponse.json({ closed: true }, { status: 404 });
  const data = await waitForOutput(ssh);
  return NextResponse.json({ data, closed: ssh.closed });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ session: string }> }) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;
  const { session: id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  if (body.resize) {
    const cols = Math.min(500, Math.max(20, Math.round(Number(body.resize.cols)) || 0));
    const rows = Math.min(200, Math.max(5, Math.round(Number(body.resize.rows)) || 0));
    if (!resizeSession(id, session.sub, cols, rows)) {
      return NextResponse.json({ closed: true }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  }

  const data = typeof body.data === "string" ? body.data : "";
  if (!writeSession(id, session.sub, data)) {
    return NextResponse.json({ closed: true }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ session: string }> }) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;
  const { session: id } = await ctx.params;
  const ssh = getSession(id, session.sub);
  if (ssh) {
    closeSession(id);
    audit(req, {
      actorType: "admin",
      actor: session.sub,
      action: "rogue.unifi.terminal",
      target: ssh.deviceName,
      // Byte count only — never the keystrokes (they may include credentials).
      detail: { event: "close", inputBytes: ssh.bytesWritten },
    });
  }
  return NextResponse.json({ ok: true });
}
