import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { RUNBOOKS, runRunbook } from "@/lib/runbooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Runs one troubleshooting runbook and returns its findings. The probes
 * don't change config, but they actively poke the controller and devices —
 * operator level, not something a read-only monitor account should trigger. */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { write: true });
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const id = typeof body.runbook === "string" ? body.runbook : "";
  const input = typeof body.input === "string" ? body.input : undefined;
  const meta = RUNBOOKS.find((r) => r.id === id);
  if (!meta) {
    return NextResponse.json({ error: "Unknown runbook" }, { status: 400 });
  }
  if (meta.input && !input?.trim()) {
    return NextResponse.json({ error: `${meta.input.label} is required` }, { status: 400 });
  }

  try {
    const steps = await runRunbook(id, input);
    audit(req, {
      actorType: "admin",
      actor: session.sub,
      action: "troubleshoot.run",
      detail: {
        runbook: id,
        // No guest identifiers in the audit log — just outcome counts.
        results: { fail: steps.filter((s) => s.status === "fail").length, warn: steps.filter((s) => s.status === "warn").length },
      },
    });
    return NextResponse.json({ steps });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Runbook failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
