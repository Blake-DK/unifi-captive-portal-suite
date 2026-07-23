import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { getNameMaps, listStations } from "@/lib/unifi";
import { physicalMacForm } from "@/lib/mac";
import { buildRogueRows, reconnectedIgnores, type RogueStation } from "@/lib/rogueUnifi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Un-onboarded UniFi hardware: UniFi-vendor stations that are NOT adopted on
 * this site. This is what the controller's `api.err.BlockUnifiDeviceForbidden`
 * refusal was pointing at all along — those clients can never be blocked,
 * they have to be adopted, reset, or deliberately ignored.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  try {
    const [stations, maps, decisions] = await Promise.all([
      listStations(),
      getNameMaps(),
      prisma.rogueUnifiDevice.findMany(),
    ]);

    // Adopted devices are infrastructure, not rogues — same MAC-set filter the
    // clients table uses (base + interface + BSSID, probed in physical form).
    const candidates: RogueStation[] = stations
      .filter((s) => !maps.deviceMacs.has(physicalMacForm(s.mac)))
      .map((s) => ({
        mac: s.mac,
        hostname: s.hostname ?? null,
        name: s.name ?? null,
        ip: s.ip ?? null,
        oui: s.oui ?? null,
        is_wired: s.is_wired,
        uplink: s.is_wired
          ? s.sw_mac
            ? `${maps.deviceName.get(s.sw_mac.toLowerCase()) ?? s.sw_mac}${s.sw_port != null ? `:${s.sw_port}` : ""}`
            : null
          : s.ap_mac
            ? maps.deviceName.get(s.ap_mac.toLowerCase()) ?? s.ap_mac
            : null,
      }));

    // "Ignored until it reconnects" is a one-shot hide: seeing the device
    // online again clears the decision, so it returns to the list.
    const revived = reconnectedIgnores(candidates, decisions);
    if (revived.length > 0) {
      await prisma.rogueUnifiDevice.deleteMany({ where: { mac: { in: revived } } });
    }
    const live = decisions.filter((d) => !revived.includes(d.mac.toLowerCase()));

    return NextResponse.json({
      rows: buildRogueRows(candidates, live),
      revived,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "UniFi request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

const STATUSES = ["marked", "ignored", "ignored-until-reconnect"] as const;

/** Record (or clear) an operator decision about one MAC. */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { write: true });
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const mac = typeof body.mac === "string" ? body.mac.trim().toLowerCase() : "";
  const status = typeof body.status === "string" ? body.status : "";
  const note = typeof body.note === "string" ? body.note.slice(0, 200) : "";
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) {
    return NextResponse.json({ error: "A MAC address is required" }, { status: 400 });
  }

  if (status === "clear") {
    await prisma.rogueUnifiDevice.deleteMany({ where: { mac } });
  } else if ((STATUSES as readonly string[]).includes(status)) {
    await prisma.rogueUnifiDevice.upsert({
      where: { mac },
      update: { status, note },
      create: { mac, status, note },
    });
  } else {
    return NextResponse.json({ error: `Unknown status "${status}"` }, { status: 400 });
  }

  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "rogue.unifi.decision",
    target: mac,
    detail: { status, note },
  });
  return NextResponse.json({ ok: true });
}
