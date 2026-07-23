import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secrets";
import { audit } from "@/lib/audit";
import { buildDynamicConfig } from "@/lib/traefikConfig";
import { adminUpstreamUrl, logdashProfileActive, ownsProxyControlPlane } from "@/lib/portalMode";
import { markTraefikDenied, markTraefikError, markTraefikPolled } from "@/lib/traefikPollStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Traefik's HTTP provider polls this for the portal-managed dynamic config
 * (routers/services/middlewares built from the URL settings + extra proxy
 * resources). Token-gated — the bundled Traefik gets the token embedded in
 * its portal-written static config; external Traefiks copy it from the
 * Settings → URLs snippet. Accepts ?token= (what the static config uses)
 * or an X-Traefik-Token header.
 */
export async function GET(req: NextRequest) {
  // Proxy control plane: in a split deployment only the admin process serves
  // the routing config Traefik trusts (the bundled static config points the
  // provider at the admin container, and it keeps last-good config while a
  // stale one still points here), so a compromised guest side can never feed
  // Traefik routes. ownsProxyControlPlane() yields to the admin sibling only
  // when the split is actually deployed — a lone guest process (misconfig)
  // keeps serving so it can't brick its own routing.
  if (!ownsProxyControlPlane()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const presented =
    req.nextUrl.searchParams.get("token") || req.headers.get("x-traefik-token") || "";

  // A DB failure must NOT masquerade as an auth failure or an empty config:
  // Traefik's HTTP provider keeps its last-good config on a non-2xx response,
  // but a 200 with missing routers REPLACES everything — which is how a boot
  // race or DB hiccup used to make every proxied domain vanish at once.
  let s;
  try {
    s = await prisma.systemSettings.findUnique({
      where: { id: "config" },
      select: {
        traefikConfigToken: true,
        reverseProxyMode: true,
        portalBaseUrl: true,
        guestBaseUrl: true,
        adminBaseUrl: true,
        portalTargetIp: true,
      },
    });
  } catch {
    markTraefikError();
    return NextResponse.json({ error: "settings unavailable" }, { status: 503 });
  }

  const expected = decryptSecret(s?.traefikConfigToken ?? "");
  if (!expected || presented !== expected) {
    // Audited (not just logged): a wrong token here is either a stale proxy
    // config or someone probing the endpoint — both worth a trace. The URLs
    // tab surfaces the denial with the "re-save to regenerate" hint.
    markTraefikDenied();
    audit(req, {
      actorType: "system",
      actor: "traefik-config",
      action: "traefik.config.denied",
      detail: { hasToken: presented !== "" },
    });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  markTraefikPolled();

  let resources;
  try {
    resources = await prisma.proxyResource.findMany({ orderBy: { sortOrder: "asc" } });
  } catch {
    markTraefikError();
    return NextResponse.json({ error: "resources unavailable" }, { status: 503 });
  }

  const portalServiceUrl =
    s?.reverseProxyMode === "external" && s.portalTargetIp
      ? `http://${s.portalTargetIp}`
      : "http://portal:3000";

  return NextResponse.json(
    buildDynamicConfig({
      portalBaseUrl: s?.portalBaseUrl ?? "",
      guestBaseUrl: s?.guestBaseUrl ?? "",
      adminBaseUrl: s?.adminBaseUrl ?? "",
      portalServiceUrl,
      adminServiceUrl: adminUpstreamUrl(s?.reverseProxyMode ?? ""),
      resources,
      // Log dashboard router only while its containers actually exist (the
      // logdash compose profile starts them) — env-driven, see .env.example.
      ...(logdashProfileActive()
        ? {
            logdash: {
              host: (process.env.LOGDASH_HOST ?? "").trim(),
              serviceUrl: "http://logdash:3000",
            },
          }
        : {}),
    }),
  );
}
