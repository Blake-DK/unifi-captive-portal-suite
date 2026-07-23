import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";

/**
 * Guest self-service can live on its own hostname (Settings -> Portal,
 * "Guest Self-Service URL", e.g. https://wifi.example.com fronted by a
 * TLS-terminating reverse proxy) while the captive host stays
 * registration-only. Blank setting = single-host behavior everywhere.
 */

/** Normalized base URL ("" -> null, trailing slash stripped). */
export function normalizeBase(url: string | null | undefined): string | null {
  const trimmed = url?.trim().replace(/\/+$/, "");
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

/** Hostname-only comparison (ports ignored — the proxy remaps them anyway). */
export function isGuestHost(requestHost: string | null, guestBaseUrl: string | null): boolean {
  const base = normalizeBase(guestBaseUrl);
  if (!base || !requestHost) return false;
  try {
    return new URL(base).hostname === requestHost.split(":")[0].toLowerCase();
  } catch {
    return false;
  }
}

export async function getGuestBaseUrl(): Promise<string | null> {
  try {
    const s = await prisma.systemSettings.findUnique({
      where: { id: "config" },
      select: { guestBaseUrl: true },
    });
    return normalizeBase(s?.guestBaseUrl);
  } catch {
    return null;
  }
}

/** Rebuild a query string from a page's resolved searchParams record. */
export function toQueryString(sp: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value)) for (const v of value) params.append(key, v);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Server-component guard for the self-service pages: when a guest URL is
 * configured and the request arrived on a different host (e.g. the captive
 * portal host), bounce to the same path+query on the guest host. Keeps the
 * captive host registration-only and puts the host-only session cookie
 * where self-service actually lives.
 */
export async function redirectToGuestHostIfNeeded(pathWithQuery: string): Promise<void> {
  const base = await getGuestBaseUrl();
  if (!base) return;
  const host = (await headers()).get("host");
  if (!host || isGuestHost(host, base)) return;
  redirect(`${base}${pathWithQuery.startsWith("/") ? "" : "/"}${pathWithQuery}`);
}
