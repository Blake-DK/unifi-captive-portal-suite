import { NextRequest, NextResponse } from "next/server";
import dns from "node:dns/promises";
import { getPortalConfig } from "@/lib/config";
import { requireAdmin } from "@/lib/adminGuard";
import { isIpHost, urlHost } from "@/lib/traefikConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Best-effort detection of the portal host's LAN IP for the "Portal target"
 * field. The captive/guest/admin hostnames must resolve to the Traefik/portal
 * host for the portal to work at all, so resolving them from inside the stack
 * answers the question; a bare-IP captive URL or an IP Host header (admin
 * browsing by IP) answers it directly. Always operator-editable — this only
 * suggests.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, { settings: true });
  if (error) return error;
  const cfg = await getPortalConfig();

  const candidates: { host: string; source: string }[] = [];
  for (const [url, source] of [
    [cfg.portalBaseUrl, "captive portal URL"],
    [cfg.guestBaseUrl, "guest URL"],
    [cfg.adminBaseUrl, "admin URL"],
  ] as const) {
    const h = urlHost(url || "");
    if (h) candidates.push({ host: h, source });
  }
  const reqHost = (req.headers.get("host") ?? "").split(":")[0];
  if (reqHost) candidates.push({ host: reqHost, source: "the address this page was opened on" });

  for (const c of candidates) {
    if (isIpHost(c.host)) {
      if (!c.host.startsWith("127.")) return NextResponse.json({ ip: c.host, source: c.source });
      continue;
    }
    try {
      const r = await dns.lookup(c.host, { family: 4 });
      if (r.address && !r.address.startsWith("127.")) {
        return NextResponse.json({ ip: r.address, source: `${c.source} (${c.host})` });
      }
    } catch {
      // unresolvable — try the next candidate
    }
  }
  return NextResponse.json({
    ip: null,
    error: "Could not resolve any portal hostname to an IP from inside the stack — enter the host's LAN IP manually.",
  });
}
