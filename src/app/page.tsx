import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { isGuestHost } from "@/lib/guestHost";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const settings = await prisma.systemSettings.findUnique({ where: { id: "config" } });
  const requestHost = (await headers()).get("host")?.split(":")[0];

  // The guest self-service host's front door is the account area, not the
  // captive registration flow.
  const guestBase = settings?.guestBaseUrl || "";
  if (isGuestHost(requestHost ?? null, guestBase)) {
    redirect("/portal/login");
  }

  let canonicalTarget: string | null = null;
  if (settings?.portalBaseUrl) {
    try {
      const target = new URL(settings.portalBaseUrl);
      if (requestHost && target.hostname !== requestHost) {
        canonicalTarget = `${settings.portalBaseUrl.replace(/\/$/, "")}/portal`;
      }
    } catch {
      // malformed portalBaseUrl — fall back to the relative redirect below
    }
  }

  redirect(canonicalTarget ?? "/portal");
}
