import { prisma } from "./prisma";
import { listAlarms, type UniFiStation } from "./unifi";
import {
  classifyDuplicateIp,
  parseArpingMap,
  parseDuplicateIpAlarm,
  type DupIpAlarm,
  type DupIpVerdict,
  type SessionWindow,
} from "./dupIp";
import { arpingProbe } from "./dupIpArping";
import type { DesiredAlert } from "./alerts";

/**
 * The duplicate-IP suppression gate, run inside the alert cycle: poll
 * stat/alarm, classify each duplicate-IP entry (dupIp.ts checks a–c, arping d),
 * return DesiredAlerts for genuine conflicts, and upsert everything gated into
 * SuppressedAlert so suppression stays auditable. In dry-run mode nothing is
 * returned — even genuine verdicts only land in the log (verdict "genuine"),
 * which is how the operator validates the parser/checks against live alarms
 * before letting the alert fire.
 */

type DupIpSettings = {
  dupIpDryRun: boolean;
  dupIpCheckMacRandom: boolean;
  dupIpCheckSessions: boolean;
  dupIpCheckDhcp: boolean;
  dupIpCheckArping: boolean;
  dupIpArpingMap: string;
};

// SSH probes per cycle — an alarm storm must not become an SSH storm.
const ARPING_CYCLE_BUDGET = 3;

/** Dedupe alarms to one per (ip, mac pair), keeping the newest timestamp. */
function dedupeAlarms(alarms: DupIpAlarm[]): DupIpAlarm[] {
  const byKey = new Map<string, DupIpAlarm>();
  for (const a of alarms) {
    const key = `${a.ip}|${a.macs.join(",")}`;
    const prev = byKey.get(key);
    if (!prev || (a.timeMs ?? 0) > (prev.timeMs ?? 0)) byKey.set(key, a);
  }
  return [...byKey.values()];
}

export async function runDupIpGate(
  s: DupIpSettings,
  stations: UniFiStation[],
): Promise<{ desired: DesiredAlert[]; suppressed: number; genuine: number }> {
  const raw = await listAlarms();
  const alarms = dedupeAlarms(
    raw.map((a) => parseDuplicateIpAlarm(a)).filter((a): a is DupIpAlarm => a !== null),
  );
  if (alarms.length === 0) return { desired: [], suppressed: 0, genuine: 0 };

  const nowSec = Math.floor(Date.now() / 1000);
  const windows = new Map<string, SessionWindow>();
  for (const sta of stations) {
    windows.set(sta.mac.toLowerCase(), {
      startSec: sta.assoc_time ?? (sta.uptime != null ? nowSec - sta.uptime : undefined),
      endSec: sta.last_seen ?? nowSec,
    });
  }
  const checks = {
    macRandom: s.dupIpCheckMacRandom,
    sessions: s.dupIpCheckSessions,
    dhcp: s.dupIpCheckDhcp,
  };
  const arpingMap = parseArpingMap(s.dupIpArpingMap);

  const desired: DesiredAlert[] = [];
  let suppressedCount = 0;
  let genuineCount = 0;
  let arpingBudget = ARPING_CYCLE_BUDGET;

  for (const alarm of alarms) {
    let result: DupIpVerdict = classifyDuplicateIp(alarm, checks, {
      windows,
      stations: stations.map((st) => ({ mac: st.mac, ip: st.ip })),
    });

    // (d) On-wire validation for the undecided — authoritative but heavy, so
    // budgeted. An unavailable probe must NOT suppress: fall through as
    // unverified instead of hiding a possible conflict.
    if (result.verdict === "inconclusive" && s.dupIpCheckArping && arpingBudget > 0) {
      arpingBudget--;
      const probed = await arpingProbe(alarm.ip, alarm.vlan, arpingMap);
      if (probed) result = { ...probed, reasons: [...result.reasons, ...probed.reasons] };
    }

    const genuine = result.verdict !== "suppress";
    if (genuine) genuineCount++;
    else suppressedCount++;

    if (genuine && !s.dupIpDryRun) {
      const label = `${alarm.ip}${alarm.vlan != null ? ` (VLAN ${alarm.vlan})` : ""}`;
      desired.push({
        target: `dupip:${alarm.ip}`,
        targetName: label,
        type: "duplicate_ip",
        severity: result.verdict === "genuine" ? "error" : "warning",
        message:
          result.verdict === "genuine"
            ? `Duplicate IP ${label}: ${result.reasons.join("; ")}${alarm.macs.length ? ` — ${alarm.macs.join(" / ")}` : ""}`
            : `Possible duplicate IP ${label} (unverified: ${result.reasons.join("; ")})${alarm.macs.length ? ` — ${alarm.macs.join(" / ")}` : ""}`,
        value: alarm.macs.join(" / ") || undefined,
      });
    }

    // Log every classification — suppression must be auditable, and in
    // dry-run this log IS the feature's whole output.
    if (!genuine || s.dupIpDryRun) {
      const [macA = "", macB = ""] = alarm.macs;
      const where = { ip_macA_macB: { ip: alarm.ip, macA, macB } };
      const existing = await prisma.suppressedAlert.findUnique({ where });
      const alarmAt = alarm.timeMs ? new Date(alarm.timeMs) : null;
      const isNewOccurrence =
        alarmAt && (!existing?.lastAlarmAt || alarmAt.getTime() > existing.lastAlarmAt.getTime());
      await prisma.suppressedAlert.upsert({
        where,
        create: {
          ip: alarm.ip,
          macA,
          macB,
          vlan: alarm.vlan ?? null,
          reasons: result.reasons,
          verdict: result.verdict,
          lastAlarmAt: alarmAt,
        },
        update: {
          lastSeenAt: new Date(),
          reasons: result.reasons,
          verdict: result.verdict,
          vlan: alarm.vlan ?? undefined,
          ...(isNewOccurrence ? { lastAlarmAt: alarmAt, count: { increment: 1 } } : {}),
        },
      });
    }
  }

  return { desired, suppressed: suppressedCount, genuine: genuineCount };
}
