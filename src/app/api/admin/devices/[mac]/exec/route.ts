import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { deviceHostForMac, getSshCredentials, runCommand } from "@/lib/deviceSsh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Runs one arbitrary command over SSH on a device. Full-admin only; the exact
 * command is recorded in the audit log. The host is resolved from the device
 * list — never from the caller — so this can't be pointed off the fleet.
 */
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

  const body = await req.json().catch(() => ({}));
  const command = typeof body.command === "string" ? body.command.trim() : "";
  if (!command) return NextResponse.json({ error: "A command is required" }, { status: 400 });

  // Audit intent BEFORE running — an audit row exists even if the command hangs.
  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "device.exec",
    target: host.name,
    detail: { ip: host.ip, command },
  });

  try {
    const output = await runCommand(host.ip, creds, command, 30_000);
    return NextResponse.json({ output });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Command failed" }, { status: 502 });
  }
}
