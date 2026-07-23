import { NextResponse } from "next/server";
import { getBuildInfo } from "@/lib/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Unauthenticated liveness + build-identity check, so "which build is this
 * container running?" is one curl away: compare `commit` to the tip of main.
 */
export async function GET() {
  const build = getBuildInfo();
  return NextResponse.json(
    { ok: true, version: build.version, commit: build.sha, builtAt: build.builtAt },
    // Build identity only changes on deploy; a short cache lets external
    // monitors poll freely without every hit reaching the handler. The
    // container healthcheck (30s interval) is unaffected.
    { headers: { "Cache-Control": "public, max-age=30" } },
  );
}
