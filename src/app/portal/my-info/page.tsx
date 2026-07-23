import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { GUEST_COOKIE, verifyGuestSessionToken } from "@/lib/guestAuth";
import { getProfileForPhone } from "@/lib/guestProfile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MyInfoForm } from "@/components/portal/MyInfoForm";
import { redirectToGuestHostIfNeeded } from "@/lib/guestHost";

export const dynamic = "force-dynamic";

export default async function MyInfoPage() {
  // Host guard first: the session cookie is host-only and lives on the
  // guest self-service host when one is configured.
  await redirectToGuestHostIfNeeded("/portal/my-info");
  // Defense in depth alongside src/proxy.ts, which already gates this route.
  const token = (await cookies()).get(GUEST_COOKIE)?.value;
  const phone = await verifyGuestSessionToken(token);
  if (!phone) redirect("/portal/login");

  const profile = await getProfileForPhone(phone);
  if (!profile) redirect("/portal/login");

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader>
          <CardTitle className="text-2xl">Your Info</CardTitle>
          <CardDescription>
            Update your name and email. Your phone number stays fixed since it&apos;s how you log
            in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <MyInfoForm initial={profile} />
          <div className="rounded-md border p-3 text-sm">
            <p className="font-medium">Your data</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Download everything this portal stores about you — registrations, devices, times
              and locations — as a JSON file. The privacy notice explains retention and how to
              request erasure.
            </p>
            <a
              href="/api/portal/my-data"
              className="mt-2 inline-block rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            >
              Download my data
            </a>
          </div>
          <a
            href="/portal/my-devices"
            className="block text-center text-sm text-muted-foreground underline hover:text-foreground"
          >
            Back to your devices
          </a>
        </CardContent>
      </Card>
    </main>
  );
}
