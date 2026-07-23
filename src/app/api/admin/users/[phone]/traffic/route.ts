import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getDpiTraffic } from "@/lib/unifi";
import { aggregateTraffic, parseHours } from "@/lib/trafficReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One guest's DPI breakdown across all their devices. Traffic grant required. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ phone: string }> },
) {
  const { session, error } = await requireAdmin(req, { traffic: true });
  if (error) return error;

  const phone = decodeURIComponent((await params).phone);
  // Per-guest lookups are the privacy-sensitive ones — always leave a trace.
  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "traffic.guest_view",
    target: phone,
  });
  const regs = await prisma.guestRegistration.findMany({
    where: { phone },
    orderBy: { authorizedAt: "desc" },
  });
  if (regs.length === 0) {
    return NextResponse.json({ error: "Unknown user" }, { status: 404 });
  }
  const labelByMac = new Map<string, string | null>();
  for (const r of regs) {
    if (!labelByMac.has(r.macAddress)) labelByMac.set(r.macAddress, r.label);
  }

  const hours = parseHours(req.nextUrl.searchParams.get("hours"));
  const end = Date.now();
  const start = end - hours * 3_600_000;

  try {
    const perMac = await Promise.all(
      [...labelByMac.keys()].map(async (mac) => ({
        mac,
        traffic: await getDpiTraffic(start, end, mac),
      })),
    );

    const allUsage = perMac.flatMap((m) => m.traffic.flatMap((c) => c.usage_by_app));
    const combined = aggregateTraffic(allUsage);

    const devices = perMac
      .map(({ mac, traffic }) => {
        const usage = traffic.flatMap((c) => c.usage_by_app);
        const { apps } = aggregateTraffic(usage);
        return {
          mac,
          label: labelByMac.get(mac) ?? null,
          deviceName: traffic[0]?.client.name || traffic[0]?.client.hostname || null,
          total: usage.reduce((s, u) => s + (u.total_bytes ?? 0), 0),
          apps: apps.slice(0, 15),
        };
      })
      .sort((a, b) => b.total - a.total);

    return NextResponse.json({ hours, ...combined, devices });
  } catch (err) {
    const message = err instanceof Error ? err.message : "UniFi request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
