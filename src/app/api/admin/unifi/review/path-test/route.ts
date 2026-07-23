import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { getPortalConfig } from "@/lib/config";
import {
  detectFirewallEngine,
  listDevices,
  listFirewallPolicies,
  listFirewallRules,
  listNetworks,
} from "@/lib/unifi";
import { testFirewallPath } from "@/lib/firewallPathTest";
import { checkVlanPath } from "@/lib/vlanTrace";
import type { PlanNetwork } from "@/lib/firewallPlan";
import type { ZbfZone } from "@/lib/zbfPlan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A serialisable VLAN-transport verdict for one simulated endpoint. */
type VlanCheck = {
  end: "source" | "destination";
  device: string;
  network: string;
  ok: boolean;
  unknown: boolean;
  blockedAt?: { deviceName: string; portIdx?: number; summary: string };
  hops: string[];
};

/**
 * Read-only what-if: simulate src→dst against the LIVE firewall state.
 * Optional srcDeviceMac/dstDeviceMac anchor an endpoint to an adopted device
 * (e.g. an AP): its uplink chain is then checked for VLAN transport, so a
 * trunk port that drops the VLAN shows up next to the policy verdict.
 */
export async function POST(req: NextRequest) {
  const { error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const opt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const protocol = body.protocol === "tcp" || body.protocol === "udp" ? body.protocol : null;
  const srcDeviceMac = opt(body.srcDeviceMac)?.toLowerCase() ?? null;
  const dstDeviceMac = opt(body.dstDeviceMac)?.toLowerCase() ?? null;

  await getPortalConfig(); // cheap guard that settings exist; engine data below
  try {
    const rawNetworks = await listNetworks();
    const networks: PlanNetwork[] = rawNetworks
      .filter((n) => !(n.purpose ?? "").startsWith("wan"))
      .map((n) => ({ id: n._id, name: n.name, vlan: n.vlan, subnet: n.ip_subnet, isGuest: n.purpose === "guest" }));
    const detection = await detectFirewallEngine();
    const zones: ZbfZone[] = detection.zones.map((z) => ({
      id: z._id,
      name: z.name ?? z._id,
      networkIds: z.network_ids ?? [],
    }));
    const zbf = detection.zbfDetected && zones.length > 0;
    // The zone holding the WAN networks is the "Internet" side of the matrix.
    const wanIds = new Set(
      rawNetworks.filter((n) => (n.purpose ?? "").startsWith("wan")).map((n) => n._id),
    );
    const internetZone = zbf
      ? zones.find((z) => z.networkIds.some((id) => wanIds.has(id))) ?? null
      : null;

    const srcIp = str(body.srcIp);
    const dstIp = str(body.dstIp);
    const result = testFirewallPath({
      srcIp,
      dstIp,
      port: opt(body.port),
      protocol,
      srcNetworkId: opt(body.srcNetworkId),
      dstNetworkId: opt(body.dstNetworkId),
      networks,
      zones: zbf ? zones : null,
      internetZone,
      policies: zbf ? await listFirewallPolicies() : null,
      rules: zbf ? null : await listFirewallRules(),
    });

    // Device-anchored ends: walk the device's uplink chain and confirm the
    // endpoint's VLAN is actually forwarded on every hop toward the gateway.
    const vlanChecks: VlanCheck[] = [];
    if (srcDeviceMac || dstDeviceMac) {
      const devices = await listDevices();
      const netOfIp = (ip: string) =>
        networks.find((n) => {
          const [base, bits] = (n.subnet ?? "").split("/");
          if (!base || !bits) return false;
          const toInt = (x: string) => x.split(".").reduce((a, o) => a * 256 + Number(o), 0);
          const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
          return ((toInt(ip) & mask) >>> 0) === ((toInt(base) & mask) >>> 0);
        });
      for (const [end, mac, ip] of [
        ["source", srcDeviceMac, srcIp],
        ["destination", dstDeviceMac, dstIp],
      ] as const) {
        if (!mac) continue;
        const device = devices.find((d) => d.mac.toLowerCase() === mac);
        const net = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) ? netOfIp(ip) : undefined;
        if (!device || !net) continue;
        const check = checkVlanPath(devices, device, net.id, rawNetworks);
        vlanChecks.push({
          end,
          device: device.name || device.mac,
          network: `${net.name}${net.vlan ? ` (VLAN ${net.vlan})` : ""}`,
          ok: check.ok,
          unknown: check.unknown,
          blockedAt: check.blockedAt,
          hops: check.hops.map(
            (h) =>
              `${h.device.name || h.device.mac}${h.portIdx != null ? ` port ${h.portIdx}` : ""}${h.wireless ? " (mesh)" : ""}`,
          ),
        });
      }
    }

    return NextResponse.json({ ...result, engine: zbf ? "zone-based" : "classic", vlanChecks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "UniFi request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
