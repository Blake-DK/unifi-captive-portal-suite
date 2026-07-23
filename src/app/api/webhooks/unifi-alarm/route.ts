import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secrets";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { runAlertCycle } from "@/lib/alertMonitor";
import { checkAdminAccess } from "@/lib/adminHost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * UniFi alarm webhook ingress: point the controller's webhook at this URL
 * with `Authorization: Bearer <secret>` (or `?secret=`) and an alarm push
 * triggers an immediate alert cycle — the same dup-IP gate and alert engine
 * the poller feeds, minus the poll latency. Off unless a secret is saved in
 * Settings → Monitoring; the payload body is deliberately not parsed (the
 * cycle re-reads the controller's alarm list itself, so a forged body can
 * inject nothing).
 */

// Coalesce alarm bursts into one cycle run.
const DEBOUNCE_MS = 2_000;
let scheduled = false;

function triggerCycleSoon(): void {
  if (scheduled) return;
  scheduled = true;
  const t = setTimeout(() => {
    scheduled = false;
    runAlertCycle().catch((e) => console.error("Webhook-triggered alert cycle failed:", e));
  }, DEBOUNCE_MS);
  t.unref?.();
}

function secretsMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  // Bind to the admin host: this webhook lives under /api/webhooks (not
  // /api/admin), so neither requireAdmin nor the Traefik blockAdmin prefix
  // covers it. When adminBaseUrl is set it must not answer on guest hosts.
  // (Host binding only — not the management-CIDR check, since the controller
  // posting the webhook may sit outside the admin allowlist.)
  if ((await checkAdminAccess(req)) === "wrong-host") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const row = await prisma.systemSettings
    .findUnique({ where: { id: "config" }, select: { alarmWebhookSecret: true } })
    .catch(() => null);
  const expected = decryptSecret(row?.alarmWebhookSecret ?? "") || "";
  if (!expected) return NextResponse.json({ error: "Not configured" }, { status: 404 });

  // Wrong-secret attempts are rate limited so the endpoint can't be brute
  // forced; a correct secret is never limited (alarm bursts are the point).
  const presented =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    req.nextUrl.searchParams.get("secret") ??
    "";
  if (!secretsMatch(presented, expected)) {
    if (!rateLimit(`alarm-webhook:${clientIp(req) ?? "unknown"}`, 30, 15 * 60 * 1000)) {
      return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  triggerCycleSoon();
  return NextResponse.json({ ok: true }, { status: 202 });
}
