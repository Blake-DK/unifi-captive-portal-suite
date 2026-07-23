import { prisma } from "@/lib/prisma";
import { ConfigHistoryView } from "@/components/admin/ConfigHistoryView";

export const dynamic = "force-dynamic";

/**
 * Controller config history: change-driven versions of the controller's
 * config collections (networks, WLANs, port profiles, firewall, settings),
 * with per-collection diffs between any two versions. Read-only by design —
 * the portal never pushes configuration back.
 */
export default async function ConfigHistoryPage() {
  const snapshots = await prisma.configSnapshot.findMany({
    orderBy: { id: "desc" },
    take: 100,
    select: { id: true, takenAt: true, hash: true, summary: true },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Config history</h1>
        <p className="text-sm text-muted-foreground">
          Versions of the controller&apos;s configuration, stored only when something actually
          changed (hourly watch; enable it under Settings → Monitoring). Secrets are
          fingerprinted before storage — a rotated passphrase shows as a change without the
          passphrase ever being kept. Diff any two versions; restores stay a deliberate manual
          act in the UniFi console.
        </p>
      </div>
      <ConfigHistoryView
        snapshots={snapshots.map((s) => ({
          id: s.id,
          takenAt: s.takenAt.toISOString(),
          hash: s.hash.slice(0, 12),
          summary: (s.summary ?? null) as Record<
            string,
            { added: number; removed: number; changed: number }
          > | null,
        }))}
      />
    </div>
  );
}
