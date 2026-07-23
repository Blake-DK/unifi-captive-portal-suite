import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { closeSession, getSession, resizeSession, waitForOutput, writeSession } from "@/lib/sshSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Terminal transport over plain HTTP (Next's `next start` can't upgrade to
 * websockets cleanly): long-poll GET drains shell output, POST writes
 * keystrokes, DELETE closes. Ownership is enforced by the admin sub.
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

  // Resize messages ride the same channel as keystrokes.
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
      action: "device.terminal",
      target: ssh.deviceName,
      // Sized trace of what went into the shell — byte count only, never the
      // contents (they may include credentials typed at prompts).
      detail: { event: "close", inputBytes: ssh.bytesWritten },
    });
  }
  return NextResponse.json({ ok: true });
}
