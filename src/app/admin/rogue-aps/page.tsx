import { listAccessPoints, listDevices, listRogueAps, listStations, listWlans } from "@/lib/unifi";
import { classifyRogues, ourSsidSet } from "@/lib/rogueAps";
import { groupRogueSightings, rogueCandidates } from "@/lib/rogueApLocate";
import { RogueApTable, type RogueRow } from "@/components/admin/RogueApTable";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * Neighbouring-AP ("rogue AP") visibility from the controller's own scan
 * (`stat/rogueap`). The security-relevant case is an evil twin: a neighbour
 * broadcasting one of our SSIDs — those are highlighted and also raise a
 * `rogue_ap` alert. Each row expands to a signal map (which of our APs hears it,
 * loudest = nearest) and any on-network device that might be broadcasting it.
 */
export default async function RogueApsPage() {
  let rows: RogueRow[] = [];
  let error: string | null = null;
  let scanned = 0;

  try {
    const [rogues, wlans, aps, devices, stations] = await Promise.all([
      listRogueAps(),
      listWlans().catch(() => []),
      listAccessPoints().catch(() => []),
      listDevices().catch(() => []),
      listStations().catch(() => []),
    ]);
    scanned = rogues.length;

    const apName = new Map(aps.map((a) => [a.mac.toLowerCase(), a.name || a.mac]));
    const deviceName = new Map(devices.map((d) => [d.mac.toLowerCase(), d.name || d.mac]));
    const staByMac = new Map(stations.map((s) => [s.mac.toLowerCase(), s]));
    // Our own adopted gear can appear in the station list as wired clients — never
    // offer it as "a device that might be the rogue".
    const ourMacs = new Set(devices.map((d) => d.mac.toLowerCase()));
    const candidateMacs = stations.map((s) => s.mac.toLowerCase()).filter((m) => !ourMacs.has(m));

    const whereOf = (s: (typeof stations)[number]): string | null => {
      if (s.ap_mac) return `via ${apName.get(s.ap_mac.toLowerCase()) ?? s.ap_mac}${s.essid ? ` (${s.essid})` : ""}`;
      if (s.sw_mac) return `${deviceName.get(s.sw_mac.toLowerCase()) ?? s.sw_mac}${s.sw_port != null ? ` port ${s.sw_port}` : ""}`;
      return s.is_wired ? "wired" : null;
    };

    const grouped = groupRogueSightings(classifyRogues(rogues, ourSsidSet(wlans.map((w) => w.name))));

    rows = grouped.map((g) => ({
      bssid: g.bssid,
      ssid: g.ssid,
      security: g.security,
      channel: g.channel,
      radio: g.radio,
      signal: g.sightings[0]?.rssi,
      oui: g.oui,
      spoofing: g.spoofing,
      open: g.open,
      ageMin: g.ageMin,
      sightings: g.sightings.map((s) => ({ apMac: s.apMac, apName: apName.get(s.apMac) ?? s.apMac, rssi: s.rssi })),
      candidates: rogueCandidates(g.bssid, candidateMacs)
        .slice(0, 12)
        .map((c) => {
          const s = staByMac.get(c.mac);
          return {
            mac: c.mac,
            name: s ? s.name || s.hostname || "" : "",
            ip: s?.ip ?? null,
            vendor: s?.oui ?? "",
            where: s ? whereOf(s) : null,
            reason: c.reason,
            confidence: c.confidence,
          };
        }),
    }));
  } catch (err) {
    error = err instanceof Error ? err.message : "Error querying UniFi";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Rogue APs</h1>
        <p className="text-sm text-muted-foreground">
          Neighbouring access points the site&apos;s radios saw (UniFi <code>/stat/rogueap</code>). A neighbour
          broadcasting one of your SSIDs is a possible <strong>evil twin</strong> — those are flagged here and raise an
          alert. Expand a row to see where it is (by signal) and which of your devices might be broadcasting it.
        </p>
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6 text-destructive">{error}</CardContent>
        </Card>
      )}

      {!error && scanned === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No neighbouring APs reported. UniFi populates this from periodic RF scans; if it stays empty, enable scanning
            on the APs (or it may just be a quiet RF environment).
          </CardContent>
        </Card>
      ) : (
        <RogueApTable rows={rows} />
      )}
    </div>
  );
}
