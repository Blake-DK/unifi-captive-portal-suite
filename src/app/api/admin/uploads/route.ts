import { NextRequest, NextResponse } from "next/server";
import { readdir, stat } from "fs/promises";
import { join } from "path";
import { requireAdmin } from "@/lib/adminGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|ico)$/i;
const MAX_ENTRIES = 200;

/** Image library: every previously uploaded image, newest first. */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const dir = join(process.cwd(), "public", "uploads");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return NextResponse.json({ files: [] });
  }

  const files = await Promise.all(
    names
      .filter((n) => IMAGE_EXT.test(n))
      .map(async (name) => {
        const s = await stat(join(dir, name)).catch(() => null);
        return { name, url: `/api/uploads/${name}`, uploadedAt: s?.mtime.toISOString() ?? null };
      }),
  );
  files.sort((a, b) => (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? ""));

  return NextResponse.json({ files: files.slice(0, MAX_ENTRIES) });
}
