import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resourceFromParams(params: Promise<{ id: string }>) {
  const { id: raw } = await params;
  const id = Number.parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  return prisma.proxyResource.findUnique({ where: { id } });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const existing = await resourceFromParams(ctx.params);
  if (!existing) return NextResponse.json({ error: "Resource not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name || name.length > 60) {
      return NextResponse.json({ error: "A name (max 60 chars) is required" }, { status: 400 });
    }
    data.name = name;
  }
  if (typeof body.hostname === "string") {
    const hostname = body.hostname.trim().toLowerCase();
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(hostname)) {
      return NextResponse.json({ error: "Hostname must be a valid FQDN" }, { status: 400 });
    }
    data.hostname = hostname;
  }
  if (typeof body.targetUrl === "string") {
    try {
      const u = new URL(body.targetUrl.trim());
      if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "h2c:") throw new Error();
      data.targetUrl = body.targetUrl.trim().replace(/\/+$/, "");
    } catch {
      return NextResponse.json({ error: "Target must be an http(s) or h2c URL" }, { status: 400 });
    }
  }
  if ("tls" in body) data.tls = Boolean(body.tls);
  if ("blockAdminPaths" in body) data.blockAdminPaths = Boolean(body.blockAdminPaths);
  if ("enabled" in body) data.enabled = Boolean(body.enabled);
  if ("sortOrder" in body) data.sortOrder = Math.round(Number(body.sortOrder) || 0);

  const updated = await prisma.proxyResource.update({ where: { id: existing.id }, data });

  const changed = Object.keys(data).filter(
    (k) => existing[k as keyof typeof existing] !== data[k],
  );
  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "proxy.resource.update",
    target: updated.hostname,
    detail: { id: updated.id, changed },
  });
  return NextResponse.json({ resource: updated });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const existing = await resourceFromParams(ctx.params);
  if (!existing) return NextResponse.json({ error: "Resource not found" }, { status: 404 });

  await prisma.proxyResource.delete({ where: { id: existing.id } });
  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "proxy.resource.delete",
    target: existing.hostname,
    detail: { id: existing.id },
  });
  return NextResponse.json({ ok: true });
}
