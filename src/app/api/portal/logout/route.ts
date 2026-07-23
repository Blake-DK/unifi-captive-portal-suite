import { NextRequest, NextResponse } from "next/server";
import { GUEST_COOKIE } from "@/lib/guestAuth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return logout(req);
}

export async function POST(req: NextRequest) {
  return logout(req);
}

async function logout(_req: NextRequest) {
  // Relative Location, resolved by the browser against whatever origin the
  // guest is actually on — `new URL(path, req.url)` produced localhost here,
  // since Next no longer derives req.url from the Host header.
  // 303 so a POSTed logout redirects as a GET.
  const res = new NextResponse(null, {
    status: 303,
    headers: { location: "/portal/login" },
  });
  res.cookies.delete(GUEST_COOKIE);
  return res;
}
