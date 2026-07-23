import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { hashPassword } from "@/lib/passwords";
import { SENTINEL_SUBS } from "@/lib/auth";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USERNAME_RE = /^[a-z0-9_-]{3,32}$/;

export async function GET(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const accounts = await prisma.adminUser.findMany({
    orderBy: { username: "asc" },
    select: {
      id: true,
      username: true,
      role: true,
      canViewTraffic: true,
      totpEnabled: true,
      createdAt: true,
      lastLoginAt: true,
      expiresAt: true,
    },
  });
  return NextResponse.json({ accounts, self: session.sub });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role = ["admin", "operator", "monitor"].includes(body.role) ? body.role : "monitor";

  if (!USERNAME_RE.test(username)) {
    return NextResponse.json(
      { error: "Username must be 3–32 characters: lowercase letters, digits, - or _" },
      { status: 400 },
    );
  }
  // Sentinels for shared-password sessions — a real account with one of these
  // names would be mistaken for one everywhere session.sub is checked.
  if (SENTINEL_SUBS.includes(username)) {
    return NextResponse.json({ error: "That username is reserved" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  // The very first account is the person setting the system up — give them
  // the Traffic-data grant so nothing is invisible to them out of the box
  // (it's off by default for everyone created after, per least privilege).
  const isFirstAccount = (await prisma.adminUser.count()) === 0;

  try {
    const created = await prisma.adminUser.create({
      data: { username, passwordHash: await hashPassword(password), role, canViewTraffic: isFirstAccount },
      select: { id: true, username: true, role: true, canViewTraffic: true },
    });
    audit(req, {
      actorType: "admin",
      actor: session.sub,
      action: "account.create",
      target: username,
      detail: { role, canViewTraffic: isFirstAccount },
    });
    return NextResponse.json({ ok: true, account: created });
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "P2002") {
      return NextResponse.json({ error: "Username already exists" }, { status: 409 });
    }
    throw err;
  }
}
