import { NextResponse } from "next/server";
import { getVersionStatus } from "@/lib/updateCheck";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Unauthenticated version check, reachable wherever the portal is (incl.
 * through the public reverse-proxy hostnames): the running build plus —
 * when the update check is enabled in Settings → Monitoring — the latest
 * release and an `upToDate` verdict. /api/health already exposes the running
 * version, so this reveals nothing newly sensitive; the GitHub token never
 * leaves the server. Answers come from an hourly in-process cache, so
 * external monitors can poll this freely.
 */
export async function GET() {
  return NextResponse.json(await getVersionStatus(), {
    // Underlying data is cached in-process for an hour; let any proxy or
    // monitor in front absorb tighter polling too.
    headers: { "Cache-Control": "public, max-age=30" },
  });
}
