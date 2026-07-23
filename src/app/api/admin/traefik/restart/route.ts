import { writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { verifyReauth } from "@/lib/adminReauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OUT_DIR = process.env.TRAEFIK_OUT_DIR || "/app/traefik";

/**
 * Restart the bundled Traefik container. The portal holds no docker socket
 * (deliberately — it is internet-facing): this only drops a marker file
 * into the shared ./traefik mount, and the traefik-ops sidecar (the one
 * socket-holding container) performs the actual `docker restart` within a
 * couple of seconds. Admin role + fresh password/TOTP re-auth required —
 * same ceremony as the old Pangolin admin-resource apply.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const reauthFail = await verifyReauth(
    req,
    session,
    typeof body.password === "string" ? body.password : "",
    typeof body.code === "string" ? body.code : "",
    "traefik.restart",
  );
  if (reauthFail) return reauthFail;

  const s = await prisma.systemSettings
    .findUnique({ where: { id: "config" }, select: { reverseProxyMode: true } })
    .catch(() => null);
  if (s?.reverseProxyMode !== "bundled") {
    return NextResponse.json(
      { error: "The bundled Traefik is not enabled (Reverse Proxy mode is not 'bundled')." },
      { status: 400 },
    );
  }

  try {
    await writeFile(path.join(OUT_DIR, "restart-requested"), new Date().toISOString() + "\n", "utf8");
  } catch {
    return NextResponse.json(
      { error: "Could not write to the shared ./traefik mount — is it mounted?" },
      { status: 500 },
    );
  }

  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "traefik.restart",
    detail: { via: "ops-sidecar marker" },
  });
  return NextResponse.json({
    ok: true,
    note: "Restart requested — the traefik-ops sidecar picks it up within a few seconds.",
  });
}
