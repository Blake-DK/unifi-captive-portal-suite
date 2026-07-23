import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { getPortalConfig } from "@/lib/config";
import { clientIp } from "@/lib/rateLimit";
import {
  createFirewallPolicy,
  createFirewallRule,
  detectFirewallEngine,
  listFirewallPolicies,
  listFirewallRules,
  listNetworks,
} from "@/lib/unifi";
import {
  assessCriticalAddresses,
  assessLockout,
  buildFirewallPlan,
  parseCriticalAddresses,
  portalRuleName,
  type FirewallRule,
  type FirewallTarget,
  type PlanNetwork,
} from "@/lib/firewallPlan";
import { assessZbfCritical, assessZbfLockout, buildZbfPlan, policyPayload, type ZbfZone } from "@/lib/zbfPlan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Guarded auto-apply for the firewall plan. Two-step by design:
 * POST {networkIds} rebuilds the plan SERVER-SIDE from live controller data
 * (never trusting client-sent rules) and returns a preview + lockout
 * assessment; POST {networkIds, confirm:true} applies it — unless the
 * assessment says the admin's own IP sits inside a BLOCK that reaches the
 * portal, in which case applying is REFUSED outright (409), not just warned.
 *
 * Engine detection comes FIRST, and each engine plans in its own vocabulary:
 * zone-based controllers (UniFi Network 9+) get a zone-native plan written as
 * firewall policies (buildZbfPlan/policyPayload — no translation layer), and
 * classic controllers get /rest/firewallrule writes with per-ruleset indexes
 * in the 2000-2999 user window. Either way the plan is written in order
 * (ALLOWs first) and the write aborts on the first controller error, so a
 * failed ALLOW can never be followed by BLOCKs.
 */

/** Expand a classic plan rule into (rule, port) pairs — one write per port. */
function portsOf(r: FirewallRule): (string | undefined)[] {
  return r.ports === "-" ? [undefined] : r.ports.split(",").map((p) => p.trim());
}

const ruleName = portalRuleName;

function classicPayload(r: FirewallRule, ruleIndex: number, name: string, port?: string) {
  return {
    ruleset: r.ruleset,
    rule_index: ruleIndex,
    name,
    enabled: true,
    action: r.action,
    protocol: ["tcp", "udp", "tcp_udp", "icmp"].includes(r.protocol) ? r.protocol : "all",
    src_address: r.source,
    dst_address: r.destination,
    ...(port ? { dst_port: port } : {}),
    src_firewallgroup_ids: [],
    dst_firewallgroup_ids: [],
    protocol_match_excepted: false,
    logging: false,
    state_established: false,
    state_invalid: false,
    state_new: false,
    state_related: false,
    ipsec: "",
  };
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const networkIds: string[] = Array.isArray(body.networkIds)
    ? body.networkIds.filter((id: unknown): id is string => typeof id === "string")
    : [];
  const confirm = body.confirm === true;

  const cfg = await getPortalConfig();
  const portalHost = (() => {
    if (cfg.portalTargetIp) return cfg.portalTargetIp.split(":")[0];
    try {
      return new URL(cfg.portalBaseUrl).hostname;
    } catch {
      return "";
    }
  })();
  const proxyHost = cfg.reverseProxyMode === "bundled" ? portalHost : "";

  try {
    const rawNetworks = await listNetworks();
    // Drop WAN networks: they are the uplink, never a firewall source/target
    // (and must not become isolation destinations). Matches the picker.
    const networks: PlanNetwork[] = rawNetworks
      .filter((n) => !(n.purpose ?? "").startsWith("wan"))
      .map((n) => ({
        id: n._id,
        name: n.name,
        vlan: n.vlan,
        subnet: n.ip_subnet,
        isGuest: n.purpose === "guest",
        // Manual DHCP DNS entries — must match the review GET so the applied
        // plan equals the previewed one.
        dnsServers:
          n.dhcpd_dns_enabled !== false
            ? [n.dhcpd_dns_1, n.dhcpd_dns_2, n.dhcpd_dns_3, n.dhcpd_dns_4].filter(
                (d): d is string => !!d,
              )
            : [],
      }));
    const selected = networks.filter((n) => networkIds.includes(n.id));
    const portalTarget: FirewallTarget = { name: "Portal", ip: portalHost };
    const proxyTarget: FirewallTarget | null = proxyHost ? { name: "Traefik", ip: proxyHost } : null;
    const targetIps = [...new Set([portalHost, proxyHost].filter(Boolean))];
    const adminIp = clientIp(req) ?? null;

    // Engine first — the plan itself is engine-shaped. Zones endpoint variants
    // differ across 9.x builds; the probe log rides along for diagnosis.
    const detection = await detectFirewallEngine();
    const zones: ZbfZone[] = detection.zones.map((z) => ({
      id: z._id,
      name: z.name ?? z._id,
      networkIds: z.network_ids ?? [],
    }));
    const probeLog = detection.probes
      .map((pr) => `${pr.path} → ${pr.ok ? `${pr.count} item(s)${pr.sampleKeys?.length ? ` keys:[${pr.sampleKeys.join(",")}]` : ""}` : pr.error}`)
      .join(" ; ");
    const zbf = detection.zbfDetected && zones.length > 0;

    // Critical addresses feed the plan twice: @-flagged entries become ALLOW
    // policies above the blocks, and every entry is guarded afterwards.
    const criticalEntries = parseCriticalAddresses(cfg.criticalAddresses).entries;
    const criticalAllows = criticalEntries.filter((e) => e.allow);

    const zbfPlan = zbf
      ? buildZbfPlan(selected, portalTarget, proxyTarget, networks, zones, criticalAllows)
      : null;
    const classicPlan = zbf
      ? null
      : buildFirewallPlan(
          selected,
          portalTarget,
          proxyTarget,
          networks.filter((n) => n.isGuest),
          networks,
          criticalAllows,
        );
    const assessment = zbfPlan
      ? assessZbfLockout(zbfPlan.policies, adminIp, networks, zones, targetIps)
      : assessLockout(classicPlan!.rules, adminIp, targetIps);
    // Second guard, same spirit as the lockout check: operator-declared
    // critical addresses must never end up inside a block's source.
    const critical =
      criticalEntries.length === 0
        ? null
        : zbfPlan
          ? assessZbfCritical(zbfPlan.policies, criticalEntries, networks, zones)
          : assessCriticalAddresses(classicPlan!.rules, criticalEntries);
    const planSize = zbfPlan ? zbfPlan.policies.length : classicPlan!.rules.length;
    const notes = zbfPlan ? zbfPlan.notes : classicPlan!.notes;
    const engine = zbf ? "zone-based" : detection.zbfDetected ? "zone-based (zones unresolved)" : "classic";

    if (!confirm) {
      return NextResponse.json({
        preview: zbfPlan ? zbfPlan.policies : classicPlan!.rules,
        notes,
        engine,
        critical,
        ...(detection.zbfDetected && zones.length === 0
          ? { error: `Zone-based controller detected, but no zones endpoint answered — probes: ${probeLog}` }
          : {}),
        ...assessment,
      });
    }
    if (detection.zbfDetected && zones.length === 0) {
      return NextResponse.json(
        {
          error:
            "Zone-based firewall detected (policies endpoint answered) but the zones could not be listed, " +
            `so policies can't be created safely. Endpoint probes: ${probeLog}`,
        },
        { status: 502 },
      );
    }
    if (assessment.blocked) {
      return NextResponse.json(
        { error: "Refused: this plan would cut YOUR session off from the portal.", critical, ...assessment },
        { status: 409 },
      );
    }
    if (critical?.blocked) {
      return NextResponse.json(
        {
          error: "Refused: this plan would cut a critical address off the network.",
          critical,
          ...assessment,
          blocked: true,
        },
        { status: 409 },
      );
    }
    if (planSize === 0) {
      return NextResponse.json(
        { error: `Nothing to apply — the plan is empty.${notes[0] ? ` ${notes[0]}` : ""}` },
        { status: 400 },
      );
    }

    const applied: string[] = [];
    const skipped: string[] = [];
    const fail = (name: string, message: string) => {
      audit(req, {
        actorType: "admin",
        actor: session.sub,
        action: "unifi.firewall.apply",
        target: cfg.unifiSite,
        detail: { engine, applied, skipped, abortedOn: name, error: message.slice(0, 500) },
      });
      return NextResponse.json(
        {
          error:
            `Controller rejected “${name}”: ${message} — applying stopped there; ` +
            `${applied.length} rule(s)/policies were created before the failure (visible in the UniFi console).`,
          applied,
          skipped,
        },
        { status: 502 },
      );
    };

    if (zbfPlan) {
      const existing = await listFirewallPolicies();
      const existingNames = new Set(existing.map((p) => p.name ?? ""));
      let nextIndex =
        Math.max(
          9999,
          ...existing.filter((p) => p.predefined !== true).map((p) => Number(p.index)).filter(Number.isFinite),
        ) + 1;

      // Ground-truth schema sample for diagnostics: an existing policy on this
      // very controller whose endpoints look most like what we write (IP
      // destination beats any non-ANY destination beats anything).
      const sample =
        existing.find((p) => p.destination?.matching_target === "IP") ??
        existing.find((p) => p.destination && p.destination.matching_target !== "ANY") ??
        existing[0];
      const sampleJson = sample
        ? JSON.stringify({ name: sample.name, source: sample.source, destination: sample.destination })
        : "none on controller";

      for (const p of zbfPlan.policies) {
        const name = ruleName(p.name, p.destination.port);
        if (existingNames.has(name)) {
          skipped.push(name);
          continue;
        }
        const payload = policyPayload(p, nextIndex++, name);
        try {
          await createFirewallPolicy(payload);
          applied.push(name);
        } catch (e) {
          // Both the payload we sent and an existing policy from the same
          // controller ride along, so a 400 is diagnosable as a field-level
          // diff instead of another guess.
          const message = e instanceof Error ? e.message : String(e);
          return fail(
            name,
            `${message} — payload: ${JSON.stringify(payload)} — existing policy for comparison: ${sampleJson}`,
          );
        }
      }
    } else {
      const existing = await listFirewallRules();
      const existingNames = new Set(existing.map((r) => r.name ?? ""));
      // Classic user rules live per-ruleset in the 2000-2999 window.
      const nextIndexByRuleset = new Map<string, number>();
      const nextIndex = (ruleset: string): number => {
        if (!nextIndexByRuleset.has(ruleset)) {
          const used = existing
            .filter((r) => r.ruleset === ruleset)
            .map((r) => Number(r.rule_index))
            .filter((i) => Number.isFinite(i) && i >= 2000 && i < 3000);
          nextIndexByRuleset.set(ruleset, Math.max(1999, ...used) + 1);
        }
        const idx = nextIndexByRuleset.get(ruleset)!;
        nextIndexByRuleset.set(ruleset, idx + 1);
        return idx;
      };

      for (const r of classicPlan!.rules) {
        for (const port of portsOf(r)) {
          const name = ruleName(r.description, port);
          if (existingNames.has(name)) {
            skipped.push(name);
            continue;
          }
          try {
            await createFirewallRule(classicPayload(r, nextIndex(r.ruleset), name, port));
            applied.push(name);
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            return fail(
              name,
              message.includes("FirewallRuleIndexOutOfRange")
                ? `${message} — this usually means a zone-based controller; ZBF probes: ${probeLog || "none answered"}`
                : message,
            );
          }
        }
      }
    }

    audit(req, {
      actorType: "admin",
      actor: session.sub,
      action: "unifi.firewall.apply",
      target: cfg.unifiSite,
      detail: { engine, applied, skipped, adminIp: assessment.adminIp },
    });
    return NextResponse.json({ applied, skipped, engine, ...assessment });
  } catch (err) {
    const message = err instanceof Error ? err.message : "UniFi request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
