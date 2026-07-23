import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return logout(req);
}

export async function POST(req: NextRequest) {
  return logout(req);
}

async function logout(_req: NextRequest) {
  // Relative Location: `new URL(path, req.url)` produced localhost, since
  // Next no longer derives req.url from the Host header.
  const res = new NextResponse(null, {
    status: 303,
    headers: { location: "/admin/login" },
  });
  res.cookies.delete(ADMIN_COOKIE);
  return res;
}
