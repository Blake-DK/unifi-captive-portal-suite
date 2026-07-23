import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { GUEST_COOKIE, verifyGuestSessionToken } from "@/lib/guestAuth";
import { getActiveDevicesForPhone } from "@/lib/guestDevices";
import { getPortalConfig } from "@/lib/config";
import { getLiveStatusForMacs, type LiveDeviceStatus } from "@/lib/liveStatus";
import { getUsageForMacs, type DeviceUsage } from "@/lib/usageStats";
import { formatBytes } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortableTable } from "@/components/admin/SortableTable";
import { RandomMacBadge } from "@/components/admin/RandomMacBadge";
import { AddDeviceForm } from "@/components/portal/AddDeviceForm";
import { VerifyBanner } from "@/components/portal/VerifyBanner";
import { getMailSettings, isEmailVerificationActive } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { redirectToGuestHostIfNeeded } from "@/lib/guestHost";
import { RemoveDeviceButton } from "@/components/portal/RemoveDeviceButton";
import { RenewDeviceButton } from "@/components/portal/RenewDeviceButton";
import { DeviceLabelEditor } from "@/components/portal/DeviceLabelEditor";
import { ExpiresCountdown } from "@/components/portal/ExpiresCountdown";
import { UsageSparkline } from "@/components/UsageSparkline";

export const dynamic = "force-dynamic";

function StatusBadge({ status }: { status?: LiveDeviceStatus }) {
  if (!status) {
    return <span className="text-xs text-muted-foreground">Status unavailable</span>;
  }
  if (!status.online) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" /> Offline
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Online{status.apName ? ` — ${status.apName}` : ""}
    </span>
  );
}

export default async function MyDevicesPage() {
  // Host guard first: the session cookie is host-only and lives on the
  // guest self-service host when one is configured.
  await redirectToGuestHostIfNeeded("/portal/my-devices");
  // Defense in depth alongside src/proxy.ts, which already gates this route.
  const token = (await cookies()).get(GUEST_COOKIE)?.value;
  const phone = await verifyGuestSessionToken(token);
  if (!phone) redirect("/portal/login");

  const [devices, cfg, mail] = await Promise.all([
    getActiveDevicesForPhone(phone),
    getPortalConfig(),
    getMailSettings(),
  ]);

  let verifyPendingEmail: string | null = null;
  if (isEmailVerificationActive(mail)) {
    const latest = await prisma.guestRegistration.findFirst({
      where: { phone, anonymizedAt: null },
      orderBy: { authorizedAt: "desc" },
      select: { email: true, emailVerifiedAt: true },
    });
    if (latest?.email && !latest.emailVerifiedAt) verifyPendingEmail = latest.email;
  }

  // Each falls back independently — UniFi being unreachable (or the report
  // store lacking data) still leaves the device list rendering.
  let liveMap = new Map<string, LiveDeviceStatus>();
  let usageMap = new Map<string, DeviceUsage>();
  const macs = devices.map((d) => d.macAddress);
  const [liveRes, usageRes] = await Promise.allSettled([
    getLiveStatusForMacs(macs),
    getUsageForMacs(macs),
  ]);
  if (liveRes.status === "fulfilled") liveMap = liveRes.value;
  if (usageRes.status === "fulfilled") usageMap = usageRes.value;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-3xl shadow-xl">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-2xl">Your Devices</CardTitle>
            <CardDescription>
              {devices.length} of {cfg.maxDevicesPerPhone} devices used
            </CardDescription>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <a href="/portal/my-info" className="text-muted-foreground underline hover:text-foreground">
              Edit your info
            </a>
            <a href="/api/portal/logout" className="text-muted-foreground underline hover:text-foreground">
              Log out
            </a>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {verifyPendingEmail && <VerifyBanner email={verifyPendingEmail} />}
          {devices.length > 0 ? (
            <>
              {/* Phones: one card per device — a six-column table can't fit. */}
              <div className="space-y-3 sm:hidden">
                {devices.map((d) => {
                  const usage = usageMap.get(d.macAddress);
                  const expiresAt =
                    d.durationMin > 0
                      ? new Date(d.authorizedAt.getTime() + d.durationMin * 60_000)
                      : null;
                  return (
                    <div key={d.id} className="space-y-2 rounded-lg border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <DeviceLabelEditor
                          mac={d.macAddress}
                          label={d.label}
                          hostname={liveMap.get(d.macAddress)?.hostname}
                        />
                        <StatusBadge status={liveMap.get(d.macAddress)} />
                      </div>
                      <p className="font-mono text-xs text-muted-foreground">
                        {d.macAddress}
                        <RandomMacBadge mac={d.macAddress} className="ml-1.5" />
                      </p>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-2">
                          {usage ? (
                            <>
                              <UsageSparkline
                                points={usage.hourly}
                                title={`Down ${formatBytes(usage.rxBytes)} · Up ${formatBytes(usage.txBytes)}`}
                              />
                              {formatBytes(usage.totalBytes)} (24h)
                            </>
                          ) : (
                            <span className="text-muted-foreground">Usage unavailable</span>
                          )}
                        </span>
                        <span title={expiresAt?.toLocaleString() ?? "No expiry"}>
                          Expires:{" "}
                          {expiresAt ? <ExpiresCountdown expiresAt={expiresAt.toISOString()} /> : "Never"}
                        </span>
                      </div>
                      <div className="flex gap-2 pt-1">
                        {expiresAt && <RenewDeviceButton mac={d.macAddress} />}
                        <RemoveDeviceButton mac={d.macAddress} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Wider screens: the table view. */}
              <div className="hidden sm:block">
                <SortableTable>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Label</TableHead>
                      <TableHead>MAC</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Usage (24h)</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {devices.map((d) => {
                      const usage = usageMap.get(d.macAddress);
                      const expiresAt =
                        d.durationMin > 0
                          ? new Date(d.authorizedAt.getTime() + d.durationMin * 60_000)
                          : null;
                      return (
                        <TableRow key={d.id}>
                          <TableCell>
                            <DeviceLabelEditor
                              mac={d.macAddress}
                              label={d.label}
                              hostname={liveMap.get(d.macAddress)?.hostname}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {d.macAddress}
                            <RandomMacBadge mac={d.macAddress} className="ml-1.5" />
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={liveMap.get(d.macAddress)} />
                          </TableCell>
                          <TableCell>
                            {usage ? (
                              <span className="flex items-center gap-2">
                                <UsageSparkline
                                  points={usage.hourly}
                                  title={`Down ${formatBytes(usage.rxBytes)} · Up ${formatBytes(usage.txBytes)}`}
                                />
                                <span className="text-xs">{formatBytes(usage.totalBytes)}</span>
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">Unavailable</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className="text-xs" title={expiresAt?.toLocaleString() ?? "No expiry"}>
                              {expiresAt ? <ExpiresCountdown expiresAt={expiresAt.toISOString()} /> : "Never"}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="flex justify-end gap-2">
                              {expiresAt && <RenewDeviceButton mac={d.macAddress} />}
                              <RemoveDeviceButton mac={d.macAddress} />
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                </SortableTable>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No devices yet.</p>
          )}

          {devices.length < cfg.maxDevicesPerPhone ? (
            <AddDeviceForm />
          ) : (
            <p className="text-sm text-muted-foreground">
              Device limit reached ({cfg.maxDevicesPerPhone}). Remove one to add another.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
