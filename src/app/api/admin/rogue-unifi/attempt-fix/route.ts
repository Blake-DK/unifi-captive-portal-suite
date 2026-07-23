import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { getSshCredentials, runCommand } from "@/lib/deviceSsh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Attempt to reach an un-onboarded UniFi device over SSH with the saved
 * credentials (the UniFi factory default ubnt/ubnt is always tried last —
 * getSshCredentials appends it), and report what it found. READ-ONLY: it runs
 * `info`, never a reset. Resetting is destructive and stays a human decision
 * in the terminal, with the exact command shown here.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const ip = typeof body.ip === "string" ? body.ip.trim() : "";
  if (!/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(ip)) {
    return NextResponse.json({ error: "The device has no usable IP address" }, { status: 400 });
  }

  const creds = await getSshCredentials();
  const attempts: { username: string; ok: boolean; error?: string }[] = [];

  for (const cred of creds) {
    try {
      // `info` is the UniFi device status command; the fallback keeps output
      // useful on non-UniFi hardware that happens to answer.
      const out = await runCommand(ip, [cred], "info 2>/dev/null || uname -a", 12_000);
      attempts.push({ username: cred.username, ok: true });
      audit(req, {
        actorType: "admin",
        actor: session.sub,
        action: "rogue.unifi.probe",
        target: ip,
        detail: { username: cred.username, outcome: "authenticated" },
      });
      return NextResponse.json({
        ok: true,
        username: cred.username,
        info: out.slice(0, 4000),
        attempts,
        // Shown, never run automatically — a factory reset wipes the device.
        resetHint:
          "To factory-reset from the terminal: `syswrapper.sh restore-default` (APs/switches) " +
          "or hold the physical reset button ~10s. After it reboots it will appear in the " +
          "controller as a pending adoption.",
      });
    } catch (err) {
      attempts.push({
        username: cred.username,
        ok: false,
        error: err instanceof Error ? err.message.slice(0, 160) : "failed",
      });
    }
  }

  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "rogue.unifi.probe",
    target: ip,
    detail: { outcome: "no-credential-worked", tried: attempts.length },
    outcome: "failure",
  });
  return NextResponse.json(
    {
      ok: false,
      attempts,
      error:
        `None of the ${attempts.length} saved credential(s) authenticated to ${ip}. ` +
        "Open the terminal to try a different login, or factory-reset the device physically.",
    },
    { status: 502 },
  );
}
