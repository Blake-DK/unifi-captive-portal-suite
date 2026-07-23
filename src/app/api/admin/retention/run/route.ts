import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { runRetention } from "@/lib/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const stats = await runRetention();

  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "retention.run",
    detail: { ...stats },
  });

  return NextResponse.json({ stats });
}
