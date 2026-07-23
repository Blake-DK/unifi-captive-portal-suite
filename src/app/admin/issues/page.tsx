import { getSiteHealth, listControllerEvents, listDevices, listStations } from "@/lib/unifi";
import { applyDeviceIgnores } from "@/lib/ignoredDevices";
import { collectIssues } from "@/lib/issues";
import { getBlockedDevicesMap } from "@/lib/blockedDevices";
import { prisma } from "@/lib/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { IssuesBoard, type BoardIssue } from "@/components/admin/IssuesBoard";
import { ConnectionFunnel } from "@/components/admin/ConnectionFunnel";

export const dynamic = "force-dynamic";

const EVENT_WINDOW_HOURS = 24;

function since(d: Date): string {
  const m = Math.floor((Date.now() - d.getTime()) / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

export default async function IssuesPage() {
  let error: string | null = null;
  const board: BoardIssue[] = [];

  try {
    const [allDevices, rawHealth, stations, events] = await Promise.all([
      listDevices(),
      getSiteHealth().catch(() => []),
      listStations().catch(() => []),
      listControllerEvents(EVENT_WINDOW_HOURS).catch(() => []),
    ]);
    // Devices ignored while offline raise no issues (site-wide decision) — the
    // controller's health counts need the same subtraction.
    const { devices, health } = await applyDeviceIgnores(allDevices, rawHealth);
    const { issues } = collectIssues({ health, devices, stations, events, eventWindowHours: EVENT_WINDOW_HOURS });
    board.push(...issues);
  } catch (err) {
    error = err instanceof Error ? err.message : "Error querying UniFi";
  }

  // Open alerts and blocked devices come from the DB, so they surface even
  // when the controller is unreachable.
  const [openAlerts, blocked] = await Promise.all([
    prisma.alert.findMany({ where: { resolvedAt: null }, orderBy: [{ severity: "asc" }, { firstSeenAt: "asc" }] }).catch(() => []),
    getBlockedDevicesMap().catch(() => new Map()),
  ]);
  for (const a of openAlerts) {
    board.push({
      severity: a.severity === "error" ? "error" : "warning",
      category: "alert",
      deviceMac: a.target.includes(":") ? a.target.toLowerCase() : undefined,
      deviceName: a.targetName,
      text: a.message,
      sinceLabel: `open ${since(a.firstSeenAt)}`,
    });
  }
  for (const [mac, b] of blocked) {
    board.push({
      severity: "warning",
      category: "blocked",
      deviceMac: mac,
      deviceName: mac,
      text: `Blocked by ${b.blockedBy} — ${b.reason}`,
      sinceLabel: since(b.blockedAt),
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Issues</h1>
        <p className="text-sm text-muted-foreground">
          Every current problem in one place: device/subsystem health, flapping links (from the
          controller event log, last {EVENT_WINDOW_HOURS}h), congested radios, weak-signal clients,
          open alerts, and blocked devices.
        </p>
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6 text-destructive">{error}</CardContent>
        </Card>
      )}

      <ConnectionFunnel />

      <IssuesBoard issues={board} />
    </div>
  );
}
