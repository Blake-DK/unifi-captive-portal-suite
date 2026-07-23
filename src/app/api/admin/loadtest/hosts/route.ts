import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { encryptSecret } from "@/lib/secrets";
import { audit } from "@/lib/audit";
import { generateKeyPair } from "@/lib/loadTest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_HOSTS = 16;

/** List generator boxes. Returns the public key (to add to authorized_keys); never the private key. */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const hosts = await prisma.loadTestHost.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, label: true, host: true, port: true, username: true, publicKey: true, createdAt: true },
  });
  return NextResponse.json({ hosts });
}

/** Add a generator box; the portal mints a dedicated ed25519 keypair for it. */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  if ((await prisma.loadTestHost.count()) >= MAX_HOSTS) {
    return NextResponse.json({ error: `At most ${MAX_HOSTS} hosts` }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const host = typeof body.host === "string" ? body.host.trim() : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const port = Math.min(65535, Math.max(1, Math.round(Number(body.port) || 22)));
  if (!host || !username) {
    return NextResponse.json({ error: "Host and username are required" }, { status: 400 });
  }

  const { publicKey, privateKey } = generateKeyPair();
  const created = await prisma.loadTestHost.create({
    data: { host, username, label, port, publicKey, privateKey: encryptSecret(privateKey) },
    select: { id: true, label: true, host: true, port: true, username: true, publicKey: true },
  });
  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "loadtest.host.create",
    target: host,
    detail: { username, label, port },
  });
  return NextResponse.json({ ok: true, host: created });
}
