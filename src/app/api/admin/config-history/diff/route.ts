import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { diffLines, stableJson, type DiffLine } from "@/lib/configDiff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Per-collection line diff between two snapshots (a older, b newer). */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, { settings: true });
  if (error) return error;
  const a = Number(req.nextUrl.searchParams.get("a"));
  const b = Number(req.nextUrl.searchParams.get("b"));
  if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) {
    return NextResponse.json({ error: "Pick two different snapshots" }, { status: 400 });
  }
  const [older, newer] = await Promise.all([
    prisma.configSnapshot.findUnique({ where: { id: Math.min(a, b) } }),
    prisma.configSnapshot.findUnique({ where: { id: Math.max(a, b) } }),
  ]);
  if (!older || !newer) return NextResponse.json({ error: "Unknown snapshot" }, { status: 404 });

  const prev = older.data as Record<string, unknown>;
  const next = newer.data as Record<string, unknown>;
  const collections: Record<string, DiffLine[]> = {};
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    const at = stableJson(prev[key] ?? [], 2);
    const bt = stableJson(next[key] ?? [], 2);
    if (at !== bt) collections[key] = diffLines(at, bt);
  }
  return NextResponse.json({
    a: { id: older.id, takenAt: older.takenAt },
    b: { id: newer.id, takenAt: newer.takenAt },
    collections,
  });
}
