import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import { join } from "path";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Gerar nome único para evitar colisões
    const timestamp = Date.now();
    const originalName = file.name.replace(/\s+/g, "_");
    const fileName = `${timestamp}_${originalName}`;
    const path = join(process.cwd(), "public", "uploads", fileName);

    await writeFile(path, buffer);

    audit(req, {
      actorType: "admin",
      actor: session.sub,
      action: "settings.upload",
      target: fileName,
      detail: { size: buffer.length },
    });

    return NextResponse.json({
      success: true, 
      url: `/api/uploads/${fileName}` 
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
