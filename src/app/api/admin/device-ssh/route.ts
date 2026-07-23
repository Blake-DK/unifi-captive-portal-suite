import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { encryptSecret } from "@/lib/secrets";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CREDS = 10;

/** List configured device SSH credentials (never returns passwords). */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const rows = await prisma.deviceSshCredential.findMany({
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, label: true, username: true, port: true },
  });
  return NextResponse.json({ credentials: rows });
}

/** Add a credential. */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const count = await prisma.deviceSshCredential.count();
  if (count >= MAX_CREDS) {
    return NextResponse.json({ error: `At most ${MAX_CREDS} credentials` }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const port = Math.min(65535, Math.max(1, Math.round(Number(body.port) || 22)));
  if (!username || !password) {
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
  }

  const created = await prisma.deviceSshCredential.create({
    data: { username, password: encryptSecret(password), label, port, sortOrder: count },
    select: { id: true, label: true, username: true, port: true },
  });
  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "device_ssh.create",
    detail: { username, label, port },
  });
  return NextResponse.json({ ok: true, credential: created });
}
