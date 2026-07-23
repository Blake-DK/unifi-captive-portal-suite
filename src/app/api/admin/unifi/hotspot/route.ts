import { NextRequest, NextResponse } from "next/server";
import dns from "node:dns/promises";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { getPortalConfig } from "@/lib/config";
import {
  getGuestAccessSetting,
  listWlans,
  setWlanGuestPolicy,
  settingEq,
  updateGuestAccessSetting,
} from "@/lib/unifi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hotspot configuration helper: GET compares the controller's guest_access
 * section against what this portal needs (external portal server pointed at
 * us); POST applies that config and syncs which SSIDs have guest policies.
 */

type Check = { key: string; label: string; desired: unknown; current: unknown; ok: boolean };

function desiredGuestAccess(portalBaseUrl: string, portalTargetIp: string): Record<string, unknown> {
  const url = new URL(portalBaseUrl);
  const host = url.hostname;
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  // The controller REQUIRES custom_ip whenever auth is "custom" — it feeds
  // the guest firewall's pre-auth allow rule — even when guests are
  // redirected by hostname (api.err.CustomAuthMissingExternalServer
  // otherwise). With a hostname URL, the portal host's LAN IP comes from the
  // "Portal target" setting on the URLs page.
  const serverIp = isIp ? host : portalTargetIp.split(":")[0];
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(serverIp)) {
    throw new MissingPortalIpError();
  }
  return {
    portal_enabled: true,
    // "custom" = External Portal Server in the UniFi UI
    auth: "custom",
    portal_customized: false,
    redirect_https: url.protocol === "https:",
    portal_use_hostname: !isIp,
    custom_ip: serverIp,
    // Only meaningful (and only kept) when redirecting by hostname; blank a
    // stale one left behind from an earlier IP-based configuration.
    portal_hostname: isIp ? "" : host,
    // UniFi's own portal auth extras are dead weight behind an external
    // portal — switch the leftovers off so the controller UI matches reality.
    voucher_enabled: false,
    payment_enabled: false,
  };
}

class MissingPortalIpError extends Error {
  constructor() {
    super(
      "The captive-portal URL uses a hostname, so the controller also needs this portal's LAN IP " +
        "for its guest firewall rule. Auto-detection failed (the hostname doesn't resolve from " +
        "inside the portal) — set “Portal target” on Settings → URLs (it has a Detect button), " +
        "save, and check again.",
    );
  }
}

/**
 * The saved Portal target wins; when it's blank/non-IP, fall back to
 * resolving the captive hostname — it must point at the portal/Traefik host
 * for guests to reach the portal at all (same logic as the URLs page's
 * auto-detect), so the check works without a saved value.
 */
async function effectiveTargetIp(portalTargetIp: string, portalBaseUrl: string): Promise<string> {
  const ipRe = /^\d{1,3}(\.\d{1,3}){3}$/;
  if (ipRe.test(portalTargetIp.split(":")[0])) return portalTargetIp;
  try {
    const host = new URL(portalBaseUrl).hostname;
    if (!ipRe.test(host)) {
      const r = await dns.lookup(host, { family: 4 });
      if (r.address && !r.address.startsWith("127.")) return r.address;
    }
  } catch {
    // fall through — desiredGuestAccess raises MissingPortalIpError
  }
  return portalTargetIp;
}

const CHECK_LABELS: Record<string, string> = {
  portal_enabled: "Guest hotspot portal enabled",
  auth: "Portal type: External Portal Server",
  portal_customized: "UniFi's own portal page disabled",
  redirect_https: "Redirect protocol matches the portal URL",
  portal_use_hostname: "Address guests by hostname vs IP",
  custom_ip: "Portal server IP (guest firewall allow rule)",
  portal_hostname: "Portal server hostname (blank when using an IP)",
  voucher_enabled: "UniFi voucher auth off (external portal handles auth)",
  payment_enabled: "UniFi payment auth off (external portal handles auth)",
};

async function buildStatus() {
  const cfg = await getPortalConfig();
  if (!cfg.portalBaseUrl) {
    return { error: "Set and save the Server Base URL first" };
  }
  const portalTargetIp = await effectiveTargetIp(cfg.portalTargetIp, cfg.portalBaseUrl);
  let desired: Record<string, unknown>;
  try {
    desired = desiredGuestAccess(cfg.portalBaseUrl, portalTargetIp);
  } catch (err) {
    if (err instanceof MissingPortalIpError) return { error: err.message };
    return { error: `Server Base URL is not a valid URL: ${cfg.portalBaseUrl}` };
  }

  const [current, wlans] = await Promise.all([getGuestAccessSetting(), listWlans()]);

  // Pre-auth allowances (walled garden): every IP the portal answers on must
  // be reachable BEFORE authentication or guests can never load the portal
  // page. Hostname URLs can't be whitelisted in guest_access, so their
  // resolved address — the portal target IP — stands in for them. Existing
  // operator-added entries are preserved after ours (stale higher-numbered
  // slots are left untouched rather than blanked).
  const ipRe = /^\d{1,3}(\.\d{1,3}){3}$/;
  const ips = new Set<string>([desired.custom_ip as string]);
  const targetIp = portalTargetIp.split(":")[0];
  if (ipRe.test(targetIp)) ips.add(targetIp);
  for (const u of [cfg.portalBaseUrl, cfg.guestBaseUrl, cfg.adminBaseUrl]) {
    try {
      const h = new URL(u).hostname;
      if (ipRe.test(h)) ips.add(h);
    } catch {}
  }
  const ours = [...ips].sort().map((ip) => `${ip}/32`);
  const existing = Object.keys(current ?? {})
    .filter((k) => /^allowed_subnet_\d+$/.test(k))
    .sort((a, b) => Number(a.split("_")[2]) - Number(b.split("_")[2]))
    .map((k) => String(current?.[k] ?? ""))
    .filter((v) => v && !ours.includes(v) && !ips.has(v.replace(/\/32$/, "")));
  [...ours, ...existing].forEach((v, i) => {
    desired[`allowed_subnet_${i + 1}`] = v;
  });

  // Absent-on-the-controller compares equal to cleared/off (settingEq) — a
  // section that never had portal_hostname is the same as one where it's
  // blanked, and a controller without voucher_enabled is the same as "off".
  const checks: Check[] = Object.entries(desired).map(([key, want]) => ({
    key,
    label:
      CHECK_LABELS[key] ??
      (key.startsWith("allowed_subnet_")
        ? `Pre-auth allowance ${key.split("_")[2]} (walled garden)`
        : key),
    desired: want,
    current: current?.[key] ?? null,
    ok: settingEq(current?.[key], want),
  }));

  return {
    portalUrl: `${cfg.portalBaseUrl.replace(/\/$/, "")}/guest/s/${cfg.unifiSite}/`,
    desired,
    checks,
    allOk: checks.every((c) => c.ok),
    wlans: wlans.map((w) => ({
      id: w._id,
      name: w.name,
      enabled: w.enabled !== false,
      isGuest: w.is_guest === true,
    })),
  };
}

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  try {
    const status = await buildStatus();
    if ("error" in status) return NextResponse.json(status, { status: 400 });
    return NextResponse.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : "UniFi request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const wlanIds: string[] = Array.isArray(body.wlanIds)
    ? body.wlanIds.filter((id: unknown): id is string => typeof id === "string")
    : [];

  try {
    const status = await buildStatus();
    if ("error" in status) return NextResponse.json(status, { status: 400 });

    const applied: string[] = [];

    if (!status.allOk) {
      await updateGuestAccessSetting(status.desired);
      applied.push("Guest portal settings updated");
    }

    // Sync guest policy to the checkbox state for every enabled SSID.
    for (const w of status.wlans) {
      if (!w.enabled) continue;
      const wantGuest = wlanIds.includes(w.id);
      if (wantGuest !== w.isGuest) {
        await setWlanGuestPolicy(w.id, wantGuest);
        applied.push(`${wantGuest ? "Enabled" : "Disabled"} guest hotspot on "${w.name}"`);
      }
    }

    audit(req, {
      actorType: "admin",
      actor: session.sub,
      action: "unifi.hotspot_apply",
      detail: { applied },
    });

    const after = await buildStatus();
    if ("error" in after) return NextResponse.json(after, { status: 400 });
    return NextResponse.json({ ...after, applied });
  } catch (err) {
    const message = err instanceof Error ? err.message : "UniFi request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
