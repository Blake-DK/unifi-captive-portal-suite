import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { downloadControllerBackup } from "@/lib/unifi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Download a fresh controller backup (.unf) — the restore artifact. The
 * portal never parses or pushes it; restores stay a deliberate manual act in
 * the UniFi console (Auvik draws the same line). */
export async function GET(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;
  let buf: Buffer;
  try {
    buf = await downloadControllerBackup();
  } catch (err) {
    const message = err instanceof Error ? err.message : "download failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "controller.backup_download",
    detail: { bytes: buf.length },
  });
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="controller-backup-${stamp}.unf"`,
    },
  });
}
