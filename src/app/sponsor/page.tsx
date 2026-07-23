import { prisma } from "@/lib/prisma";
import { hashSponsorToken, SPONSOR_LINK_EXP_MIN } from "@/lib/sponsor";
import { SponsorDecision } from "@/components/portal/SponsorDecision";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * The page a sponsor lands on from the approval email. The token in the URL
 * is the credential: no login, one use, expires an hour after issue. The
 * page only READS here — the decision itself goes through the decide API,
 * which claims the request atomically.
 */
export default async function SponsorPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const row = token
    ? await prisma.sponsorRequest.findUnique({ where: { tokenHash: hashSponsorToken(token) } })
    : null;

  const expired =
    row?.status === "pending" && row.expiresAt.getTime() < Date.now() ? true : false;
  const settings = await prisma.systemSettings.findUnique({
    where: { id: "config" },
    select: { sponsorDurationOverride: true, sponsorDefaultMin: true, brandName: true },
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader>
          <CardTitle>Guest WiFi sponsorship</CardTitle>
          <CardDescription>
            {settings?.brandName || "Guest WiFi"} — a visitor named you as their sponsor.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {!row ? (
            <p className="text-destructive">
              This link is not valid. It may have been used already — approval links work once and
              expire after {SPONSOR_LINK_EXP_MIN} minutes.
            </p>
          ) : expired ? (
            <p className="text-destructive">
              This request expired before a decision was made. The visitor can submit a new one.
            </p>
          ) : row.status !== "pending" ? (
            <p>
              This request was already <strong>{row.status}</strong>
              {row.decidedAt ? ` on ${row.decidedAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}.
            </p>
          ) : (
            <>
              <div className="space-y-1">
                <p>
                  <span className="text-muted-foreground">Visitor:</span>{" "}
                  <strong>
                    {row.firstName} {row.lastName}
                  </strong>
                </p>
                <p>
                  <span className="text-muted-foreground">Phone:</span> {row.phone}
                </p>
                <p>
                  <span className="text-muted-foreground">Device:</span>{" "}
                  <span className="font-mono text-xs">{row.macAddress}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Requested:</span>{" "}
                  {row.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Approving grants this device WiFi access and records you as the sponsor. If you
                don&apos;t recognise the visitor, deny the request.
              </p>
              <SponsorDecision
                token={token!}
                allowDuration={settings?.sponsorDurationOverride ?? true}
                defaultMin={settings?.sponsorDefaultMin ?? 1440}
              />
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
