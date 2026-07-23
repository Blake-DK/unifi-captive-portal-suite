import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { getBuildInfo } from "@/lib/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What's-new dialog backing: GET says whether this admin still has to see the
 * changelog for the running version (and hands over the notes); POST marks it
 * seen. Setup/shared sessions have no account row and never see the dialog.
 */

/** First release section of CHANGELOG.md (semantic-release "# [x.y.z]" headings). */
async function latestNotes(): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), "CHANGELOG.md"), "utf8");
    const lines = raw.split("\n");
    const isHeading = (l: string) => /^#{1,2} \[?v?\d+\.\d+\.\d+/.test(l);
    const start = lines.findIndex(isHeading);
    if (start === -1) return "";
    const end = lines.findIndex((l, i) => i > start && isHeading(l));
    return lines
      .slice(start, end === -1 ? undefined : end)
      .join("\n")
      .trim();
  } catch {
    // Image without a bundled changelog — the dialog simply doesn't show.
    return "";
  }
}

export async function GET(req: NextRequest) {
  const { session, error } = await requireAdmin(req);
  if (error) return error;

  const user = await prisma.adminUser.findUnique({ where: { username: session.sub } });
  const version = getBuildInfo().version;
  if (!user || user.lastSeenVersion === version) {
    return NextResponse.json({ show: false });
  }
  const notes = await latestNotes();
  if (!notes) return NextResponse.json({ show: false });
  return NextResponse.json({ show: true, version, notes });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req);
  if (error) return error;

  const version = getBuildInfo().version;
  await prisma.adminUser
    .updateMany({ where: { username: session.sub }, data: { lastSeenVersion: version } })
    .catch(() => {});
  return NextResponse.json({ ok: true });
}
