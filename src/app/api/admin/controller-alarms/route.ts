import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { listAlarms } from "@/lib/unifi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The controller's own alarm feed (IDS/IPS events included) — read-only,
 * newest first. The dup-IP gate consumes the same feed separately; this is
 * the raw view the alerts page shows beside the portal's own alerts. */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;
  try {
    const alarms = await listAlarms(100);
    return NextResponse.json({
      alarms: alarms
        .map((a) => ({
          time: typeof a.time === "number" ? a.time : null,
          key: a.key ?? "",
          msg: a.msg ?? "",
        }))
        .sort((a, b) => (b.time ?? 0) - (a.time ?? 0)),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Controller unreachable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
