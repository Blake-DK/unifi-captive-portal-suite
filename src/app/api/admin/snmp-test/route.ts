import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { listDevices } from "@/lib/unifi";
import { credsFromSettings, hasPollableIp, pickSample, runSweep, type SnmpTargetLite } from "@/lib/snmpFallback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proves SNMP credentials/reachability work against a small live sample
 * (one gateway, one AP, one switch when types are known) — the drill an
 * operator should run right after saving credentials, before a real outage
 * is the first time the fallback gets exercised.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const s = await prisma.systemSettings.findUnique({ where: { id: "config" } });
  if (!s?.snmpEnabled) {
    return NextResponse.json({ error: "SNMP fallback is disabled — enable it above and save first." }, { status: 400 });
  }
  if (!s.snmpUser || !s.snmpAuthKey || !s.snmpPrivKey) {
    return NextResponse.json({ error: "SNMP user and both keys are required." }, { status: 400 });
  }

  let devices;
  try {
    devices = await listDevices();
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Controller unreachable" }, { status: 502 });
  }

  const targets: SnmpTargetLite[] = devices
    .filter((d) => hasPollableIp(d.ip))
    .map((d) => ({ mac: d.mac.toLowerCase(), ip: d.ip!, name: d.name || d.mac, type: d.type }));
  const sample = pickSample(targets);
  if (sample.length === 0) {
    return NextResponse.json({ error: "No devices with a private/LAN IP to test against." }, { status: 400 });
  }

  const results = await runSweep(sample, credsFromSettings(s));
  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "snmp.test",
    detail: { sampled: sample.length, reachable: results.filter((r) => r.reachable).length },
  });

  return NextResponse.json({
    results: results.map((r) => {
      const t = sample.find((x) => x.mac === r.mac);
      return { name: t?.name ?? r.mac, ip: r.ip, reachable: r.reachable, error: r.error ?? null };
    }),
  });
}
