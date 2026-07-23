import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { DIAGNOSTICS, deviceHostForMac, getSshCredentials, runCommand } from "@/lib/deviceSsh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Runs the read-only diagnostics allowlist over SSH and returns the outputs. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ mac: string }> }) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const creds = await getSshCredentials();
  if (creds.length === 0) {
    return NextResponse.json({ error: "Set device SSH credentials in Settings → Monitoring first" }, { status: 400 });
  }
  const { mac } = await ctx.params;
  const host = await deviceHostForMac(decodeURIComponent(mac));
  if (!host) return NextResponse.json({ error: "Unknown or offline device" }, { status: 404 });

  const results: { label: string; output: string }[] = [];
  try {
    for (const d of DIAGNOSTICS) {
      const output = await runCommand(host.ip, creds, d.command).catch((e) => `error: ${e.message}`);
      results.push({ label: d.label, output: output.trim() });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "SSH failed" }, { status: 502 });
  }

  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "device.diag",
    target: host.name,
    detail: { ip: host.ip },
  });
  return NextResponse.json({ results });
}
