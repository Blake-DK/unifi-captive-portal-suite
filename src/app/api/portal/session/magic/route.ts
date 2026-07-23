import { NextRequest, NextResponse } from "next/server";
import {
  GUEST_COOKIE,
  GUEST_COOKIE_MAX_AGE,
  createGuestSessionToken,
  verifyMagicLinkToken,
} from "@/lib/guestAuth";
import { getCookieSecure } from "@/lib/config";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const phone = await verifyMagicLinkToken(req.nextUrl.searchParams.get("token"));
  // Relative Locations throughout: URLs built from req.url / req.nextUrl come
  // out as localhost, since Next no longer derives them from the Host header.
  if (!phone) {
    return new NextResponse(null, {
      status: 303,
      headers: { location: "/portal/login?expired=1" },
    });
  }

  const res = new NextResponse(null, {
    status: 303,
    headers: { location: "/portal/my-devices" },
  });
  res.cookies.set(GUEST_COOKIE, await createGuestSessionToken(phone), {
    httpOnly: true,
    sameSite: "lax",
    secure: await getCookieSecure(),
    path: "/",
    maxAge: GUEST_COOKIE_MAX_AGE,
  });
  return res;
}
