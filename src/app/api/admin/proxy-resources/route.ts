import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { traefikLastDeniedAt, traefikLastErrorAt, traefikLastPolledAt } from "@/lib/traefikPollStatus";
import { ensureConfigToken } from "@/lib/traefikStatic";
import { adminUpstreamUrl, logdashProfileActive } from "@/lib/portalMode";
import { getSettingsRow } from "@/lib/settingsRow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RESOURCES = 50;

/**
 * Extra hostnames served through the portal-managed Traefik (Settings →
 * URLs → Reverse Proxy). Changes take effect on Traefik's next config poll
 * (a few seconds) — no restart, these are dynamic-config only.
 */

function parseResource(body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const hostname = typeof body.hostname === "string" ? body.hostname.trim().toLowerCase() : "";
  const targetUrl = typeof body.targetUrl === "string" ? body.targetUrl.trim() : "";
  if (!name || name.length > 60) return { error: "A name (max 60 chars) is required" };
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(hostname)) {
    return { error: "Hostname must be a valid FQDN (e.g. ha.example.com)" };
  }
  try {
    // h2c = cleartext HTTP/2 (gRPC upstreams) — Traefik accepts it as a
    // loadBalancer server scheme alongside http/https.
    const u = new URL(targetUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "h2c:") throw new Error();
  } catch {
    return { error: "Target must be an http(s) or h2c URL Traefik can reach, e.g. http://10.90.0.50:8123" };
  }
  return {
    data: {
      name,
      hostname,
      targetUrl: targetUrl.replace(/\/+$/, ""),
      tls: body.tls !== false,
      blockAdminPaths: Boolean(body.blockAdminPaths),
      enabled: body.enabled !== false,
    },
  };
}

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;
  // Independent reads — run them together. reverseProxyMode comes from the
  // shared 15s settings cache (settings saves are admin-process-only, so it
  // stays coherent) rather than a third serialized query on the hottest row.
  const [resources, s, configToken] = await Promise.all([
    prisma.proxyResource.findMany({ orderBy: { sortOrder: "asc" } }),
    getSettingsRow(),
    // The token is needed verbatim for the external-Traefik provider snippet;
    // admin-session-gated, so exposing it here mirrors "settings admins may
    // configure the proxy".
    ensureConfigToken(),
  ]);
  return NextResponse.json({
    resources,
    configToken,
    // The copy-out preview must show what /api/traefik/config actually serves,
    // and only the server knows whether this deployment is split.
    adminServiceUrl: adminUpstreamUrl(s?.reverseProxyMode ?? ""),
    // Same parity rule for the log dashboard: env-driven and profile-gated
    // server-side, so the preview needs it handed over.
    logdash: logdashProfileActive()
      ? {
          host: (process.env.LOGDASH_HOST ?? "").trim(),
          serviceUrl: "http://logdash:3000",
        }
      : null,
    traefikLastPolledAt: traefikLastPolledAt(),
    traefikLastDeniedAt: traefikLastDeniedAt(),
    traefikLastErrorAt: traefikLastErrorAt(),
  });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const parsed = parseResource(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const count = await prisma.proxyResource.count();
  if (count >= MAX_RESOURCES) {
    return NextResponse.json({ error: `Resource limit reached (max ${MAX_RESOURCES})` }, { status: 400 });
  }
  const maxSort = await prisma.proxyResource.aggregate({ _max: { sortOrder: true } });
  const created = await prisma.proxyResource.create({
    data: { ...parsed.data, sortOrder: (maxSort._max.sortOrder ?? -1) + 1 },
  });

  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "proxy.resource.create",
    target: created.hostname,
    detail: { id: created.id, targetUrl: created.targetUrl, tls: created.tls },
  });
  return NextResponse.json({ resource: created });
}
