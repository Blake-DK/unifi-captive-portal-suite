import { Suspense } from "react";
import { VerifyConfirm } from "@/components/portal/VerifyConfirm";
import { verifyEmailVerifyToken } from "@/lib/guestAuth";
import { getSystemSettings } from "@/lib/settings";
import { redirectToGuestHostIfNeeded, toQueryString } from "@/lib/guestHost";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  // Confirmation must happen on the guest host — the confirm route sets the
  // host-only session cookie there. Preserves ?token= for old emails that
  // still point at the captive host.
  await redirectToGuestHostIfNeeded(`/portal/verify${toQueryString(sp)}`);
  const token = typeof sp.token === "string" ? sp.token : "";
  const [settings, parsed] = await Promise.all([
    getSystemSettings(),
    verifyEmailVerifyToken(token),
  ]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md">
        {parsed ? (
          <Suspense fallback={null}>
            <VerifyConfirm settings={settings} token={token} email={parsed.email} />
          </Suspense>
        ) : (
          <Card className="shadow-xl">
            <CardHeader className="text-center">
              <CardTitle>Link expired</CardTitle>
              <CardDescription>
                This confirmation link is invalid or has expired. Reconnect to the
                WiFi and use &quot;Resend the email&quot; to get a fresh one.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </main>
  );
}
