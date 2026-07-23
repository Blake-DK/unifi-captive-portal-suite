import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { initialChainWalk, walkChain } from "@/lib/auditChain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Walk the whole audit log in id order and recompute every chain link.
 * Pre-feature rows (no chainHash) and the anchor row (whose predecessor may
 * have been pruned by retention) are reported as unverifiable, not as
 * tampered. The verdict itself lands in the audit trail.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  let state = initialChainWalk();
  let cursor = 0;
  for (;;) {
    const rows = await prisma.auditLog.findMany({
      where: { id: { gt: cursor } },
      orderBy: { id: "asc" },
      take: 1000,
    });
    if (rows.length === 0) break;
    state = walkChain(state, rows);
    cursor = rows[rows.length - 1].id;
    if (state.firstBreakId !== null) break;
  }

  const ok = state.firstBreakId === null;
  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "audit.verify",
    detail: { ok, checked: state.checked, unverifiable: state.unverifiable, firstBreakId: state.firstBreakId },
    outcome: ok ? "success" : "failure",
  });
  return NextResponse.json({
    ok,
    checked: state.checked,
    unverifiable: state.unverifiable,
    firstBreakId: state.firstBreakId,
  });
}
