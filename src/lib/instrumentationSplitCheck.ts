/**
 * Boot-time guest/admin split sanity check (side-effecting wrapper around the
 * pure checkSplitConfig). Reads the proxy settings once and logs a loud warning
 * per misconfiguration. Never throws — a DB hiccup here must not break boot.
 */
import { prisma } from "./prisma";
import { adminUpstreamUrl, portalMode, splitProfileActive } from "./portalMode";
import { checkSplitConfig } from "./splitConfig";
import { isIpHost, urlHost } from "./traefikConfig";

export async function warnSplitConfig(): Promise<void> {
  try {
    // Only relevant once someone has started splitting: a plain single-container
    // deployment (no PORTAL_MODE, no split profile) can never hit any of these.
    if (portalMode() === "all" && !splitProfileActive()) return;
    const s = await prisma.systemSettings.findUnique({
      where: { id: "config" },
      select: {
        reverseProxyMode: true,
        portalBaseUrl: true,
        guestBaseUrl: true,
        adminBaseUrl: true,
      },
    });
    const reverseProxyMode = s?.reverseProxyMode ?? "none";
    const adminHost = urlHost(s?.adminBaseUrl ?? "");
    const warns = checkSplitConfig({
      mode: portalMode(),
      splitProfileActive: splitProfileActive(),
      reverseProxyMode,
      adminUpstreamUrl: adminUpstreamUrl(reverseProxyMode),
      portalHost: urlHost(s?.portalBaseUrl ?? ""),
      guestHost: urlHost(s?.guestBaseUrl ?? ""),
      adminHost,
      adminHostIsIp: !!adminHost && isIpHost(adminHost),
    });
    for (const w of warns) console.warn(`[split] ${w}`);
  } catch (err) {
    console.error("[split] config check failed:", err);
  }
}
