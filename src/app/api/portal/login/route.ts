import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { onlyDigits } from "@/lib/validators";
import { GUEST_COOKIE, GUEST_COOKIE_MAX_AGE, createGuestSessionToken } from "@/lib/guestAuth";
import { addDeviceForPhone, DeviceOpError } from "@/lib/deviceOps";
import { canonicalizeMac } from "@/lib/mac";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { getCookieSecure } from "@/lib/config";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Phone + last name is a low-entropy credential — throttle guessing.
  if (!rateLimit(`portal-login:${clientIp(req) ?? "unknown"}`, 10, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const phoneDigits = onlyDigits(typeof body.phone === "string" ? body.phone : "");
  const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";

  if (!phoneDigits || !lastName) {
    return NextResponse.json({ error: "Phone and last name are required" }, { status: 400 });
  }

  const reg = await prisma.guestRegistration.findFirst({
    where: { phone: phoneDigits, lastName: { equals: lastName, mode: "insensitive" } },
    orderBy: { authorizedAt: "desc" },
  });
  if (!reg) {
    // Phone+lastname is guessable — failed attempts are worth a trace.
    audit(req, { actorType: "guest", actor: phoneDigits, action: "guest.login", outcome: "failure" });
    return NextResponse.json({ error: "No matching registration found" }, { status: 401 });
  }

  audit(req, { actorType: "guest", actor: phoneDigits, action: "guest.login" });

  // Captive flow: when the login page was reached from the UniFi redirect it
  // carries the device's MAC — signing in from a new device then registers
  // and authorizes that device on the spot (same rules as my-devices "add":
  // device cap, hijack guard, verify-pending).
  const mac = canonicalizeMac(typeof body.mac === "string" ? body.mac : "");
  let deviceAdded = false;
  let deviceError: string | null = null;
  if (mac) {
    try {
      await addDeviceForPhone(phoneDigits, mac, {
        userAgent: req.headers.get("user-agent") ?? undefined,
        ipAddress: clientIp(req),
      });
      deviceAdded = true;
      audit(req, {
        actorType: "guest",
        actor: phoneDigits,
        action: "guest.device_add",
        target: mac,
        detail: { via: "login" },
      });
    } catch (err) {
      if (err instanceof DeviceOpError && err.status === 409 && /already on the list/.test(err.message)) {
        // This device is already theirs — logging in is all they needed.
        deviceAdded = true;
      } else {
        deviceError = err instanceof Error ? err.message : "Could not add this device";
      }
    }
  }

  const res = NextResponse.json({ ok: true, deviceAdded, deviceError });
  res.cookies.set(GUEST_COOKIE, await createGuestSessionToken(phoneDigits), {
    httpOnly: true,
    sameSite: "lax",
    secure: await getCookieSecure(),
    path: "/",
    maxAge: GUEST_COOKIE_MAX_AGE,
  });
  return res;
}
