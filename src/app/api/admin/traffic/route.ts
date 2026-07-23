import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getDpiTraffic } from "@/lib/unifi";
import { aggregateTraffic, parseHours } from "@/lib/trafficReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Site-wide DPI breakdown. Gated by the per-account traffic grant. */
export async function GET(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { traffic: true });
  if (error) return error;

  const hours = parseHours(req.nextUrl.searchParams.get("hours"));
  // Every look at traffic data leaves a trace, whether or not UniFi answers.
  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "traffic.site_view",
    detail: { hours },
  });
  const end = Date.now();
  const start = end - hours * 3_600_000;

  try {
    const clients = await getDpiTraffic(start, end);
    const { apps, categories } = aggregateTraffic(clients.flatMap((c) => c.usage_by_app));

    // Rank clients and attach the registered guest (if any) behind each MAC.
    const totals = clients
      .map((c) => ({
        mac: c.client.mac,
        deviceName: c.client.name || c.client.hostname || null,
        total: c.usage_by_app.reduce((s, u) => s + (u.total_bytes ?? 0), 0),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);
    const regs = await prisma.guestRegistration.findMany({
      where: { macAddress: { in: totals.map((t) => t.mac.toLowerCase()) } },
      orderBy: { authorizedAt: "desc" },
    });
    const guestByMac = new Map<string, { phone: string; name: string }>();
    for (const r of regs) {
      if (!guestByMac.has(r.macAddress)) {
        guestByMac.set(r.macAddress, { phone: r.phone, name: `${r.firstName} ${r.lastName}` });
      }
    }

    return NextResponse.json({
      hours,
      apps,
      categories,
      clients: totals.map((t) => ({
        ...t,
        guest: guestByMac.get(t.mac.toLowerCase()) ?? null,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "UniFi request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
