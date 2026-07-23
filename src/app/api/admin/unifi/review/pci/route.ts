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
import { checkPciSegmentation, planPciFixes, type PciCheckInput } from "@/lib/pciCheck";
import {
  assessCriticalAddresses,
  assessLockout,
  criticalSourceHits,
  parseCriticalAddresses,
  portalRuleName,
  type FirewallRule,
  type PlanNetwork,
} from "@/lib/firewallPlan";
import {
  assessZbfCritical,
  assessZbfLockout,
  policyPayload,
  zbfCriticalSourceHits,
  type ZbfZone,
} from "@/lib/zbfPlan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PCI/POS segmentation: GET runs the read-only check against the LIVE
 * firewall state; POST plans and (two-step, guarded) applies the fixable
 * remediations — explicit BLOCKs for flows that currently fall through to
 * the default action. Zone-mixing and broad allows are never auto-fixed;
 * they come back as by-hand guidance.
 */

async function loadInput(): Promise<{ input: PciCheckInput; zbf: boolean; zones: ZbfZone[] } | null> {
  const cfg = await getPortalConfig();
  const pciNetworkIds = cfg.pciNetworkIds.split(",").map((t) => t.trim()).filter(Boolean);
  if (pciNetworkIds.length === 0) return null;

  const rawNetworks = await listNetworks();
  const networks: PlanNetwork[] = rawNetworks
    .filter((n) => !(n.purpose ?? "").startsWith("wan"))
    .map((n) => ({
      id: n._id,
      name: n.name,
      vlan: n.vlan,
      subnet: n.ip_subnet,
      isGuest: n.purpose === "guest",
    }));

  const detection = await detectFirewallEngine();
  const zones: ZbfZone[] = detection.zones.map((z) => ({
    id: z._id,
    name: z.name ?? z._id,
    networkIds: z.network_ids ?? [],
  }));
  const zbf = detection.zbfDetected && zones.length > 0;

  return {
    zbf,
    zones,
    input: {
      pciNetworkIds,
      networks,
      zones: zbf ? zones : null,
      policies: zbf ? await listFirewallPolicies() : null,
      rules: zbf ? null : await listFirewallRules(),
    },
  };
}

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  try {
    const loaded = await loadInput();
    if (!loaded) return NextResponse.json({ rows: [], engine: null, pciNetworkIds: [] });
    const rows = checkPciSegmentation(loaded.input);
    return NextResponse.json({
      rows,
      engine: loaded.zbf ? "zone-based" : "classic",
      pciNetworkIds: loaded.input.pciNetworkIds,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "UniFi request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/** Keep in sync with the classic payload in review/apply — same wire shape. */
function classicPayload(r: FirewallRule, ruleIndex: number, name: string) {
  return {
    ruleset: r.ruleset,
    rule_index: ruleIndex,
    name,
    enabled: true,
    action: r.action,
    protocol: ["tcp", "udp", "tcp_udp", "icmp"].includes(r.protocol) ? r.protocol : "all",
    src_address: r.source,
    dst_address: r.destination,
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
  const confirm = body.confirm === true;
  /** Ticked policy names from the dialog; absent (null) = apply everything. */
  const selected: string[] | null = Array.isArray(body.selected)
    ? body.selected.filter((s: unknown): s is string => typeof s === "string")
    : null;
  /** The operator ticked a block that covers a critical address and chose to
   * apply it anyway; turns the critical cut-off refusal into a warning. */
  const acceptCritical = body.acceptCritical === true;
  const cfg = await getPortalConfig();

  try {
    const loaded = await loadInput();
    if (!loaded) {
      return NextResponse.json({ error: "No PCI networks are saved — tick and save them first." }, { status: 400 });
    }
    const { input, zbf, zones } = loaded;
    const fix = planPciFixes(input);

    const criticalEntries = parseCriticalAddresses(cfg.criticalAddresses).entries;
    const policyNames = fix.policies.map((p) => portalRuleName(p.name, p.destination.port));
    const ruleNames = fix.rules.map((r) => portalRuleName(r.description));
    const allNames = zbf ? policyNames : ruleNames;
    const hits = zbf
      ? zbfCriticalSourceHits(fix.policies, criticalEntries, input.networks, zones)
      : criticalSourceHits(fix.rules, criticalEntries);
    const previewItems = allNames.map((name, i) => ({ name, criticalHits: hits[i] }));

    // The confirm step applies only the ticked names; guards run on that
    // same subset so unticking a block genuinely removes its consequences.
    const wanted = (name: string) => selected === null || selected.includes(name);
    const policies = fix.policies.filter((_, i) => wanted(policyNames[i]));
    const rules = fix.rules.filter((_, i) => wanted(ruleNames[i]));
    const planSize = policies.length + rules.length;

    // Same guards as the main apply: the fix BLOCKs must sever neither this
    // admin session nor a critical address.
    const portalHost = (() => {
      if (cfg.portalTargetIp) return cfg.portalTargetIp.split(":")[0];
      try {
        return new URL(cfg.portalBaseUrl).hostname;
      } catch {
        return "";
      }
    })();
    const proxyHost = cfg.reverseProxyMode === "bundled" ? portalHost : "";
    const targetIps = [...new Set([portalHost, proxyHost].filter(Boolean))];
    const adminIp = clientIp(req) ?? null;
    const assessment = zbf
      ? assessZbfLockout(policies, adminIp, input.networks, zones, targetIps)
      : assessLockout(rules, adminIp, targetIps);
    const critical =
      criticalEntries.length === 0
        ? null
        : zbf
          ? assessZbfCritical(policies, criticalEntries, input.networks, zones)
          : assessCriticalAddresses(rules, criticalEntries);

    if (!confirm) {
      return NextResponse.json({
        preview: previewItems,
        unfixable: fix.unfixable,
        notes: fix.notes,
        engine: zbf ? "zone-based" : "classic",
        critical,
        ...assessment,
      });
    }
    if (assessment.blocked) {
      return NextResponse.json(
        { error: "Refused: these blocks would cut YOUR session off from the portal.", critical, ...assessment },
        { status: 409 },
      );
    }
    if (critical?.blocked && !acceptCritical) {
      return NextResponse.json(
        {
          error:
            "Refused: a ticked block covers a critical address in its source. Untick it, or apply anyway with acceptCritical.",
          critical,
          ...assessment,
          blocked: true,
        },
        { status: 409 },
      );
    }
    if (planSize === 0) {
      return NextResponse.json(
        {
          error: selected
            ? "Nothing is ticked — tick at least one block to apply."
            : "Nothing to fix — every flow already has an explicit policy.",
          unfixable: fix.unfixable,
        },
        { status: 400 },
      );
    }

    const applied: string[] = [];
    const skipped: string[] = [];
    if (zbf) {
      const existing = input.policies ?? [];
      const existingNames = new Set(existing.map((p) => p.name ?? ""));
      let nextIndex =
        Math.max(
          9999,
          ...existing.filter((p) => p.predefined !== true).map((p) => Number(p.index)).filter(Number.isFinite),
        ) + 1;
      for (const p of policies) {
        const name = portalRuleName(p.name, p.destination.port);
        if (existingNames.has(name)) {
          skipped.push(name);
          continue;
        }
        const payload = policyPayload(p, nextIndex++, name);
        try {
          await createFirewallPolicy(payload);
          applied.push(name);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          audit(req, {
            actorType: "admin",
            actor: session.sub,
            action: "unifi.firewall.pcifix",
            target: cfg.unifiSite,
            detail: { applied, skipped, abortedOn: name, error: message.slice(0, 500) },
          });
          return NextResponse.json(
            {
              error: `Controller rejected “${name}”: ${message} — payload: ${JSON.stringify(payload)} — applying stopped; ${applied.length} policies were created before the failure.`,
              applied,
              skipped,
            },
            { status: 502 },
          );
        }
      }
    } else {
      const existing = input.rules ?? [];
      const existingNames = new Set(existing.map((r) => r.name ?? ""));
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
      for (const r of rules) {
        const name = portalRuleName(r.description);
        if (existingNames.has(name)) {
          skipped.push(name);
          continue;
        }
        try {
          await createFirewallRule(classicPayload(r, nextIndex(r.ruleset), name));
          applied.push(name);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          audit(req, {
            actorType: "admin",
            actor: session.sub,
            action: "unifi.firewall.pcifix",
            target: cfg.unifiSite,
            detail: { applied, skipped, abortedOn: name, error: message.slice(0, 500) },
          });
          return NextResponse.json(
            {
              error: `Controller rejected “${name}”: ${message} — applying stopped; ${applied.length} rules were created before the failure.`,
              applied,
              skipped,
            },
            { status: 502 },
          );
        }
      }
    }

    const criticalAccepted = critical?.blocked
      ? critical.verdicts.filter((v) => v.status === "cut-off").map((v) => v.address)
      : [];
    audit(req, {
      actorType: "admin",
      actor: session.sub,
      action: "unifi.firewall.pcifix",
      target: cfg.unifiSite,
      detail: {
        applied,
        skipped,
        unfixable: fix.unfixable,
        adminIp: assessment.adminIp,
        unticked: selected === null ? [] : allNames.filter((n) => !selected.includes(n)),
        criticalAccepted,
      },
    });
    return NextResponse.json({ applied, skipped, unfixable: fix.unfixable, notes: fix.notes, critical, ...assessment });
  } catch (err) {
    const message = err instanceof Error ? err.message : "UniFi request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
