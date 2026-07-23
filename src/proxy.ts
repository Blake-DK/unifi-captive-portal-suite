import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, SETUP_ADMIN_SUB, verifyAdminSession } from "@/lib/auth";
import { GUEST_COOKIE, verifyGuestSessionToken } from "@/lib/guestAuth";
import { portalMode } from "@/lib/portalMode";

const GUEST_PROTECTED_PREFIXES = ["/portal/my-devices", "/portal/my-info"];

/**
 * Per-request CSP. script-src is nonce-locked — 'strict-dynamic' lets the
 * nonce'd Next bootstrap load its own chunks, and Next reads the nonce off
 * the request's CSP header to stamp its inline scripts. style-src keeps
 * 'unsafe-inline' deliberately: React style attributes are pervasive here
 * (charts, the map's pan/zoom transform) and inline styles are not the XSS
 * vector inline scripts are. Dev builds need 'unsafe-eval' (react-refresh).
 */
function buildCsp(nonce: string): string {
  const dev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
  ].join("; ");
}

/** Session gating: a redirect when the request may not pass, null otherwise. */
async function gate(req: NextRequest): Promise<NextResponse | null> {
  const { pathname } = req.nextUrl;

  // Process-role split (PORTAL_MODE): a guest process serves no admin pages,
  // an admin process serves no guest pages OR guest APIs. Unset = "all" = no-op
  // (default). The guest-API prefixes are gated here (not just via requireAdmin,
  // which only guards /api/admin) because the admin container otherwise fully
  // serves /api/portal + /api/sponsor, and per-process rate-limit buckets would
  // hand an attacker a second OTP/login budget on the admin host.
  const mode = portalMode();
  if (mode === "guest" && pathname.startsWith("/admin")) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (
    mode === "admin" &&
    (pathname.startsWith("/portal") ||
      pathname.startsWith("/guest") ||
      pathname.startsWith("/api/portal") ||
      pathname.startsWith("/api/sponsor"))
  ) {
    return new NextResponse("Not found", { status: 404 });
  }
  // API paths need no session gating or CSP below — the role check above is the
  // only middleware concern for them (they're in the matcher solely for it).
  if (pathname.startsWith("/api/")) return null;

  if (GUEST_PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
    const token = req.cookies.get(GUEST_COOKIE)?.value;
    const phone = await verifyGuestSessionToken(token);
    if (!phone) {
      const url = req.nextUrl.clone();
      url.pathname = "/portal/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return null;
  }

  if (!pathname.startsWith("/admin")) return null;
  if (pathname.startsWith("/admin/login")) return null;

  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  const session = await verifyAdminSession(token);
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  // First-time setup: the shared-password admin session exists only to create
  // a personal admin account — pin it to that page.
  if (session.sub === SETUP_ADMIN_SUB && !pathname.startsWith("/admin/settings/admins")) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/settings/admins";
    url.search = "";
    return NextResponse.redirect(url);
  }
  // Monitors are read-only: settings pages (credentials, account management)
  // and the audit trail are full-admin territory.
  if (
    (pathname.startsWith("/admin/settings") ||
      pathname.startsWith("/admin/audit") ||
      pathname.startsWith("/admin/config-history")) &&
    session.role !== "admin"
  ) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return null;
}

export async function proxy(req: NextRequest) {
  const redirect = await gate(req);
  if (redirect) return redirect; // redirects render nothing — no CSP needed

  // The nonce goes on the REQUEST headers (Next stamps its own inline
  // bootstrap scripts from the CSP header it finds there) and the same
  // policy on the response for the browser to enforce.
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("content-security-policy", csp);
  return res;
}

export const config = {
  // Every page gets the per-request CSP; API JSON, Next's static assets and
  // uploaded/served files (anything with an extension) don't need one. The
  // guest-API prefixes are matched too — solely so an admin-role process can
  // 404 them (gate() returns before any CSP work for /api/ paths).
  matcher: [
    "/((?!api|_next/static|_next/image|uploads|.*\\..*).*)",
    "/api/portal/:path*",
    "/api/sponsor/:path*",
  ],
};
