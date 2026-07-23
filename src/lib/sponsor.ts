import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Sponsored guest access: a visitor's registration request is held until a
 * designated sponsor approves it via an expiring one-use email link
 * (Purple-style mechanics; DoDI 8420.01-style host sponsorship). The pure
 * parts live here — token shapes, sponsor validation, the email — so they
 * unit-test without a database.
 */

/** Approval links die after an hour, like Purple's. */
export const SPONSOR_LINK_EXP_MIN = 60;

/** The one-use approval token: random, stored only as a sha256 hash. */
export function createSponsorToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSponsorToken(token) };
}

export function hashSponsorToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function parseSponsorList(s: string): string[] {
  return s
    .split("\n")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * A sponsor address is acceptable when it appears in the curated list, or
 * its domain matches one of the allowed domains (the wildcard-domain mode:
 * "unit.mil" admits anyone @unit.mil).
 */
export function allowedSponsor(
  email: string,
  opts: { emails: string; domains: string },
): boolean {
  const addr = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return false;
  if (parseSponsorList(opts.emails).includes(addr)) return true;
  const domain = addr.split("@")[1];
  return parseSponsorList(opts.domains).some((d) => d.replace(/^\*@/, "") === domain);
}

// HMAC over ADMIN_SECRET, domain-separated. Inlined (node:crypto only, no
// local imports) so this module loads under Node's type-stripping test
// runner, which cannot resolve extensionless sibling imports.
function watchSig(id: number): string {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) throw new Error("ADMIN_SECRET is not set");
  return createHmac("sha256", secret).update(`sponsor-watch.${id}`).digest("hex");
}

/** The guest's polling credential: proves the poller filed request `id`
 * without holding the sponsor's approval token. */
export async function createWatchToken(id: number): Promise<string> {
  return `${id}.${watchSig(id)}`;
}

export async function verifyWatchToken(token: string): Promise<number | null> {
  const [idStr, sig] = token.split(".");
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0 || !sig) return null;
  const expected = Buffer.from(watchSig(id));
  const presented = Buffer.from(sig);
  if (presented.length !== expected.length) return null;
  return timingSafeEqual(presented, expected) ? id : null;
}

export function renderSponsorEmail(opts: {
  brand: string;
  firstName: string;
  lastName: string;
  phone: string;
  mac: string;
  locationName: string | null;
  approveUrl: string;
}): { subject: string; html: string; text: string } {
  const who = `${opts.firstName} ${opts.lastName}`.trim() || opts.mac;
  const subject = `${opts.brand}: WiFi access request from ${who}`;
  const lines = [
    `${who} is asking you to sponsor their guest WiFi access.`,
    `Phone: ${opts.phone}`,
    `Device: ${opts.mac}`,
    ...(opts.locationName ? [`Location: ${opts.locationName}`] : []),
    ``,
    `Review and approve or deny here (the link works once and expires in ${SPONSOR_LINK_EXP_MIN} minutes):`,
    opts.approveUrl,
    ``,
    `If you don't recognise this request, deny it or simply ignore this email.`,
  ];
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<p>${esc(who)} is asking you to sponsor their guest WiFi access.</p>
<ul><li>Phone: ${esc(opts.phone)}</li><li>Device: ${esc(opts.mac)}</li>${opts.locationName ? `<li>Location: ${esc(opts.locationName)}</li>` : ""}</ul>
<p><a href="${opts.approveUrl}">Review this request</a> — the link works once and expires in ${SPONSOR_LINK_EXP_MIN} minutes.</p>
<p>If you don't recognise this request, deny it or simply ignore this email.</p>`;
  return { subject, html, text: lines.join("\n") };
}
