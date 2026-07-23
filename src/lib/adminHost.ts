import type { NextRequest } from "next/server";
import { prisma } from "./prisma";
import { ipInCidr } from "./firewallPlan";
import { clientIp } from "./rateLimit";

/**
 * Admin-surface isolation: when an admin hostname is configured, the admin
 * pages and APIs answer ONLY on that hostname (guests probing the captive
 * host get 404s — the surface disappears); optionally, an operator-declared
 * management-CIDR list further restricts by source address.
 *
 * Both checks are deliberately fail-open when unconfigured: a blank
 * adminBaseUrl means no host gating (single-host installs), an empty CIDR
 * list means no source gating — and the settings API refuses to SAVE a CIDR
 * list that would exclude the admin saving it, so the lockout foot-gun is
 * blocked at the door rather than at enforcement time.
 *
 * Settings are cached in-module for 30s: this runs on every admin request,
 * and a DB read per request would double the guard's query load. The cache
 * is cleared on settings save (same process).
 */

type Policy = { adminHost: string | null; cidrs: string[] };

let cached: { policy: Policy; at: number } | null = null;
const CACHE_MS = 30_000;

export function clearAdminAccessCache(): void {
  cached = null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

async function policy(): Promise<Policy> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.policy;
  let p: Policy = { adminHost: null, cidrs: [] };
  try {
    const s = await prisma.systemSettings.findUnique({
      where: { id: "config" },
      select: { adminBaseUrl: true, adminAllowedCidrs: true },
    });
    p = {
      adminHost: s?.adminBaseUrl ? hostOf(s.adminBaseUrl) : null,
      cidrs: (s?.adminAllowedCidrs ?? "").split(/[\s,]+/).map((t) => t.trim()).filter(Boolean),
    };
  } catch {
    // DB unavailable: fail open — the request will fail authentication
    // anyway, and an outage must not lock the admin out on recovery.
  }
  cached = { policy: p, at: Date.now() };
  return p;
}

/** The Host the client actually asked for (Traefik forwards it through). */
function requestHost(req: NextRequest): string {
  const raw = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return raw.split(",")[0].trim().split(":")[0].toLowerCase();
}

export type AdminAccessDenial = "wrong-host" | "ip-not-allowed";

/** null = allowed; otherwise why not. */
export async function checkAdminAccess(req: NextRequest): Promise<AdminAccessDenial | null> {
  const p = await policy();
  if (p.adminHost && requestHost(req) !== p.adminHost) return "wrong-host";
  if (p.cidrs.length > 0) {
    const ip = clientIp(req);
    if (!ip || !p.cidrs.some((c) => ipInCidr(ip, c.includes("/") ? c : `${c}/32`))) {
      return "ip-not-allowed";
    }
  }
  return null;
}

/** Server-component variant for the /admin layout (no NextRequest there). */
export async function checkAdminAccessFromHeaders(h: {
  get(name: string): string | null;
}): Promise<AdminAccessDenial | null> {
  const p = await policy();
  if (p.adminHost) {
    const raw = h.get("x-forwarded-host") ?? h.get("host") ?? "";
    const host = raw.split(",")[0].trim().split(":")[0].toLowerCase();
    if (host !== p.adminHost) return "wrong-host";
  }
  if (p.cidrs.length > 0) {
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "";
    if (!ip || !p.cidrs.some((c) => ipInCidr(ip, c.includes("/") ? c : `${c}/32`))) {
      return "ip-not-allowed";
    }
  }
  return null;
}
