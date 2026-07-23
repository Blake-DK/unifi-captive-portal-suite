import { Suspense } from "react";
import { LoginForm } from "@/components/portal/LoginForm";
import { WarningBannerGate } from "@/components/portal/WarningBannerGate";
import { prisma } from "@/lib/prisma";
import { redirectToGuestHostIfNeeded, toQueryString } from "@/lib/guestHost";

export const dynamic = "force-dynamic";

export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectToGuestHostIfNeeded(`/portal/login${toQueryString(await searchParams)}`);
  const row = await prisma.systemSettings
    .findUnique({
      where: { id: "config" },
      select: { warningBannerEnabled: true, warningBannerText: true },
    })
    .catch(() => null);
  const banner =
    row?.warningBannerEnabled && row.warningBannerText.trim() ? row.warningBannerText : null;
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="relative z-10 w-full max-w-md">
        <Suspense fallback={<div>Loading...</div>}>
          {banner ? (
            <WarningBannerGate text={banner}>
              <LoginForm />
            </WarningBannerGate>
          ) : (
            <LoginForm />
          )}
        </Suspense>
      </div>
    </main>
  );
}
