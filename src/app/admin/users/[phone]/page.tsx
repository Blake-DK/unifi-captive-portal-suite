import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getProfileForPhone } from "@/lib/guestProfile";
import { getActiveDevicesForPhone } from "@/lib/guestDevices";
import { getLiveStatusForMacs, type LiveDeviceStatus } from "@/lib/liveStatus";
import { getUsageForMacs, type DeviceUsage } from "@/lib/usageStats";
import { getClientSessions, listAccessPoints, type UniFiClientSession } from "@/lib/unifi";
import { getAdminSession, sessionCanViewTraffic } from "@/lib/adminSession";
import { getBlockedDevicesMap } from "@/lib/blockedDevices";
import { formatBytes, formatTimeRemaining } from "@/lib/utils";
import { UsageSparkline } from "@/components/UsageSparkline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortableTable } from "@/components/admin/SortableTable";
import { RandomMacBadge } from "@/components/admin/RandomMacBadge";
import { ClientLink } from "@/components/admin/ClientWindows";
import { RevokeButton } from "@/components/admin/RevokeButton";
import { BlockDeviceButton } from "@/components/admin/BlockDeviceButton";
import { EditUserProfileForm } from "@/components/admin/EditUserProfileForm";
import { AddDeviceForUserForm } from "@/components/admin/AddDeviceForUserForm";
import { DeleteUserButton } from "@/components/admin/DeleteUserButton";
import { GdprActions } from "@/components/admin/GdprActions";
import { TrafficReport } from "@/components/admin/TrafficReport";

export const dynamic = "force-dynamic";

function StatusBadge({ status }: { status?: LiveDeviceStatus }) {
  if (!status) return <span className="text-xs text-muted-foreground">Unavailable</span>;
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

function locationLabel(r: { locationType: string; locationName: string | null; baseLocation: string | null; building: string | null; roomNumber: string | null }): string {
  const parts = [r.building, r.roomNumber].filter(Boolean).join(" / Rm ");
  if (r.locationName) return parts ? `${r.locationName} — ${parts}` : r.locationName;
  // Legacy rows written before editable locations existed.
  if (r.locationType === "base") return r.baseLocation ?? "On Base";
  if (r.locationType === "deployed") return parts || "Deployed";
  return parts || "—";
}

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ phone: string }>;
}) {
  const { phone: rawPhone } = await params;
  const phone = decodeURIComponent(rawPhone);

  const profile = await getProfileForPhone(phone);
  if (!profile) notFound();

  const [devices, history, blockedByMac] = await Promise.all([
    getActiveDevicesForPhone(phone),
    prisma.guestRegistration.findMany({ where: { phone }, orderBy: { authorizedAt: "desc" } }),
    getBlockedDevicesMap(),
  ]);

  // Each block falls back independently — UniFi being unreachable still
  // leaves the profile and device list rendering.
  const macs = devices.map((d) => d.macAddress);
  let liveMap = new Map<string, LiveDeviceStatus>();
  let usageMap = new Map<string, DeviceUsage>();
  let sessions: UniFiClientSession[] = [];
  const apName = new Map<string, string>();
  const nowSec = Math.floor(Date.now() / 1000);
  const [liveRes, usageRes, apRes, ...sessionRes] = await Promise.allSettled([
    getLiveStatusForMacs(macs),
    getUsageForMacs(macs),
    listAccessPoints(),
    ...macs.map((m) => getClientSessions(m, nowSec - 7 * 86_400, nowSec)),
  ]);
  if (liveRes.status === "fulfilled") liveMap = liveRes.value as Map<string, LiveDeviceStatus>;
  if (usageRes.status === "fulfilled") usageMap = usageRes.value as Map<string, DeviceUsage>;
  if (apRes.status === "fulfilled") {
    for (const ap of apRes.value as Awaited<ReturnType<typeof listAccessPoints>>) {
      if (ap.name) apName.set(ap.mac.toLowerCase(), ap.name);
    }
  }
  for (const r of sessionRes) {
    if (r.status === "fulfilled") sessions.push(...(r.value as UniFiClientSession[]));
  }
  const apLabel = (mac?: string | null) =>
    mac ? apName.get(mac.toLowerCase()) ?? mac : "-";
  const canTraffic = await sessionCanViewTraffic(await getAdminSession());
  sessions = sessions
    .sort((a, b) => (b.assoc_time ?? 0) - (a.assoc_time ?? 0))
    .slice(0, 25);
  const labelByMac = new Map(devices.map((d) => [d.macAddress, d.label ?? d.macAddress]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {profile.firstName} {profile.lastName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {phone}
            {history[0]?.email &&
              (history[0].emailVerifiedAt ? (
                <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700">
                  email verified
                </span>
              ) : (
                <span className="ml-2 rounded bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-300">
                  email unverified
                </span>
              ))}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <DeleteUserButton phone={phone} name={`${profile.firstName} ${profile.lastName}`} />
          <GdprActions phone={phone} name={`${profile.firstName} ${profile.lastName}`} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <EditUserProfileForm phone={phone} initial={profile} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Devices ({devices.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <SortableTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>MAC</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>IP / Network</TableHead>
                <TableHead>Usage (24h)</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No active devices
                  </TableCell>
                </TableRow>
              ) : (
                devices.map((d) => {
                  const usage = usageMap.get(d.macAddress);
                  const live = liveMap.get(d.macAddress);
                  const expiresAt =
                    d.durationMin > 0
                      ? new Date(d.authorizedAt.getTime() + d.durationMin * 60_000)
                      : null;
                  return (
                    <TableRow key={d.id}>
                      <TableCell>{d.label ?? <span className="text-muted-foreground">Unlabeled</span>}</TableCell>
                      <TableCell className="font-mono text-xs">
                        <ClientLink mac={d.macAddress} hint={d.label ?? undefined}>{d.macAddress}</ClientLink>
                        <RandomMacBadge mac={d.macAddress} className="ml-1.5" />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={live} />
                      </TableCell>
                      <TableCell>
                        {live?.online ? (
                          <span className="text-xs">
                            <span className="font-mono">{live.ip ?? "-"}</span>
                            {(live.network || live.vlan != null) && (
                              <span className="block text-muted-foreground">
                                {live.network ?? "VLAN"}
                                {live.vlan != null ? ` (VLAN ${live.vlan})` : ""}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
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
                        <span className="text-xs" title={expiresAt?.toLocaleString("en-GB") ?? "No expiry"}>
                          {expiresAt ? formatTimeRemaining(expiresAt) : "Never"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <BlockDeviceButton
                            mac={d.macAddress}
                            blocked={blockedByMac.get(d.macAddress.toLowerCase()) ?? null}
                          />
                          <RevokeButton mac={d.macAddress} phone={phone} />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          </SortableTable>

          <div>
            <p className="mb-2 text-sm font-medium">Add device for this user</p>
            <AddDeviceForUserForm phone={phone} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connection Sessions — last 7 days</CardTitle>
        </CardHeader>
        <CardContent>
          <SortableTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead>Connected</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>AP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No sessions recorded (or UniFi unreachable)
                  </TableCell>
                </TableRow>
              ) : (
                sessions.map((s, i) => (
                  <TableRow key={`${s.mac}-${s.assoc_time}-${i}`}>
                    <TableCell className="text-xs">
                      <ClientLink mac={s.mac} hint={labelByMac.get(s.mac.toLowerCase())}>
                        {labelByMac.get(s.mac.toLowerCase()) ?? s.mac}
                      </ClientLink>
                      <RandomMacBadge mac={s.mac} className="ml-1.5" />
                    </TableCell>
                    <TableCell className="text-xs">
                      {s.assoc_time ? new Date(s.assoc_time * 1000).toLocaleString("en-GB") : "-"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {s.duration ? `${Math.floor(s.duration / 3600)}h ${Math.floor((s.duration % 3600) / 60)}m` : "-"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatBytes((s.rx_bytes ?? 0) + (s.tx_bytes ?? 0))}
                    </TableCell>
                    <TableCell className="text-xs">{apLabel(s.ap_mac)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </SortableTable>
        </CardContent>
      </Card>

      {canTraffic && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Traffic — apps &amp; sites</CardTitle>
          </CardHeader>
          <CardContent>
            <TrafficReport phone={phone} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Roaming History</CardTitle>
        </CardHeader>
        <CardContent>
          <SortableTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>MAC</TableHead>
                <TableHead>SSID</TableHead>
                <TableHead>Access Point</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Authorized At</TableHead>
                <TableHead>Revoked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No history
                  </TableCell>
                </TableRow>
              ) : (
                history.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      <ClientLink mac={r.macAddress}>{r.macAddress}</ClientLink>
                      <RandomMacBadge mac={r.macAddress} className="ml-1.5" />
                    </TableCell>
                    <TableCell>{r.ssid ?? "-"}</TableCell>
                    <TableCell className="text-xs">{apLabel(r.apMac)}</TableCell>
                    <TableCell>{locationLabel(r)}</TableCell>
                    <TableCell>{new Date(r.authorizedAt).toLocaleString("en-GB")}</TableCell>
                    <TableCell>
                      {r.revokedAt ? new Date(r.revokedAt).toLocaleString("en-GB") : "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </SortableTable>
        </CardContent>
      </Card>
    </div>
  );
}
