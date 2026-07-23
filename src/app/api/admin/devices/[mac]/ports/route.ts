import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { listDevices, listNetworks, listPortConfs } from "@/lib/unifi";
import { portVlanSummary } from "@/lib/vlanTrace";
import { canonicalizeMac } from "@/lib/mac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One device's port table (link, PoE, VLAN summary) for the device dialog's
 * "Ports" section — the same numbers the Network Status port cards used to
 * render at the bottom of the page.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ mac: string }> }) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const { mac: raw } = await ctx.params;
  const mac = canonicalizeMac(decodeURIComponent(raw));
  if (!mac) return NextResponse.json({ error: "Invalid MAC" }, { status: 400 });

  try {
    const [devices, networks, portConfs] = await Promise.all([
      listDevices(),
      listNetworks().catch(() => []),
      listPortConfs().catch(() => []),
    ]);
    const device = devices.find((d) => d.mac.toLowerCase() === mac);
    if (!device) return NextResponse.json({ error: "Unknown device" }, { status: 404 });
    const netName = (id?: string) => {
      const n = networks.find((x) => x._id === id);
      return n ? `${n.name.trim()}${n.vlan ? ` (${n.vlan})` : ""}` : "default";
    };
    const profileName = (id?: string) => portConfs.find((pc) => pc._id === id)?.name ?? null;
    const ports = (device.port_table ?? []).map((p) => ({
      idx: p.port_idx ?? 0,
      name: p.name ?? null,
      up: Boolean(p.up),
      speed: p.speed ?? null,
      poeWatts: p.poe_power ? Number(p.poe_power) : null,
      vlans: portVlanSummary(p, netName),
      profile: profileName(p.portconf_id),
    }));
    return NextResponse.json({ ports });
  } catch (err) {
    const message = err instanceof Error ? err.message : "UniFi request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
