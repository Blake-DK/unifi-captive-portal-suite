import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { getPortalConfig } from "@/lib/config";
import { clientIp } from "@/lib/rateLimit";
import {
  deleteFirewallPolicy,
  deleteFirewallRule,
  detectFirewallEngine,
  listFirewallPolicies,
  listFirewallRules,
  listNetworks,
} from "@/lib/unifi";
import { PORTAL_RULE_PREFIX, type PlanNetwork } from "@/lib/firewallPlan";
import { assessDeletion } from "@/lib/policyCleanup";
import type { ZbfZone } from "@/lib/zbfPlan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Firewall cleanup: GET lists what is on the controller (so the review page
 * can badge portal-created and stale entries); POST deletes, two-step like
 * the apply — POST {ids} returns an impact preview (session-severing check +
 * shielding warnings), POST {ids, confirm:true} deletes. Entries without the
 * "Portal: " prefix additionally require includeForeign:true, so cleaning up
 * our own leftovers can never quietly take someone's hand-made rule with it.
 */

type Row = {
  id: string;
  name: string;
  action: string;
  enabled: boolean;
  index: number | string | null;
  ruleset: string | null;
  predefined: boolean;
  ours: boolean;
  protocol: string;
  source: string;
  destination: string;
  port: string | null;
};

async function loadLive() {
  const detection = await detectFirewallEngine();
  const zones: ZbfZone[] = detection.zones.map((z) => ({
    id: z._id,
    name: z.name ?? z._id,
    networkIds: z.network_ids ?? [],
  }));
  const zbf = detection.zbfDetected && zones.length > 0;
  const policies = zbf ? await listFirewallPolicies() : null;
  const rules = zbf ? null : await listFirewallRules();
  return { zbf, zones, policies, rules };
}

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req, { settings: true });
  if (error) return error;
  try {
    const [{ zbf, zones, policies, rules }, rawNetworks] = await Promise.all([
      loadLive(),
      listNetworks().catch(() => []),
    ]);

    // Human labels for the live endpoint objects, resolved the way the plan
    // preview renders them: zone (any) / network names / IPs.
    const zoneName = new Map(zones.map((z) => [z.id, z.name]));
    const netName = new Map(rawNetworks.map((n) => [n._id, n.name]));
    const endpointLabel = (ep?: Record<string, unknown>): string => {
      if (!ep) return "—";
      const zone = zoneName.get(ep.zone_id as string) ?? "?";
      const target = (ep.matching_target as string | undefined) ?? "ANY";
      if (target === "NETWORK" && Array.isArray(ep.network_ids)) {
        const names = (ep.network_ids as string[]).map((id) => netName.get(id) ?? id).join(", ");
        if (names) return names;
      }
      if (target === "IP" && Array.isArray(ep.ips)) {
        const ips = (ep.ips as string[]).join(", ");
        if (ips) return ips;
      }
      return `zone “${zone}” (any)`;
    };

    const rows: Row[] = zbf
      ? (policies ?? []).map((p) => ({
          id: p._id ?? "",
          name: p.name ?? "(unnamed)",
          action: (p.action as string) ?? "?",
          enabled: p.enabled !== false,
          index: p.index ?? null,
          ruleset: null,
          predefined: p.predefined === true,
          ours: (p.name ?? "").startsWith(PORTAL_RULE_PREFIX),
          protocol: (p.protocol as string) ?? "all",
          source: endpointLabel(p.source),
          destination: endpointLabel(p.destination),
          port: typeof p.destination?.port === "string" ? (p.destination.port as string) : null,
        }))
      : (rules ?? []).map((r) => ({
          id: r._id ?? "",
          name: r.name ?? "(unnamed)",
          action: r.action ?? "?",
          enabled: r.enabled !== false,
          index: r.rule_index ?? null,
          ruleset: r.ruleset ?? null,
          predefined: false,
          ours: (r.name ?? "").startsWith(PORTAL_RULE_PREFIX),
          protocol: r.protocol ?? "all",
          source: r.src_address || "any",
          destination: r.dst_address || "any",
          port: r.dst_port ?? null,
        }));
    return NextResponse.json({ engine: zbf ? "zone-based" : "classic", rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "UniFi request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids)
    ? body.ids.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
    : [];
  const confirm = body.confirm === true;
  const includeForeign = body.includeForeign === true;
  if (ids.length === 0) {
    return NextResponse.json({ error: "Nothing selected." }, { status: 400 });
  }

  const cfg = await getPortalConfig();
  try {
    const { zbf, zones, policies, rules } = await loadLive();
    const idOf = (p: { _id?: string }) => p._id;
    const byId = new Map<string, { name: string; ours: boolean; predefined: boolean }>();
    for (const p of policies ?? []) {
      byId.set(p._id ?? "", {
        name: p.name ?? "(unnamed)",
        ours: (p.name ?? "").startsWith(PORTAL_RULE_PREFIX),
        predefined: p.predefined === true,
      });
    }
    for (const r of rules ?? []) {
      byId.set(r._id ?? "", {
        name: r.name ?? "(unnamed)",
        ours: (r.name ?? "").startsWith(PORTAL_RULE_PREFIX),
        predefined: false,
      });
    }

    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Unknown id(s): ${missing.join(", ")} — reload the list and try again.` },
        { status: 400 },
      );
    }
    const predefined = ids.filter((id) => byId.get(id)!.predefined);
    if (predefined.length > 0) {
      return NextResponse.json(
        { error: `Refused: ${predefined.map((id) => byId.get(id)!.name).join(", ")} are controller-predefined policies — manage those in UniFi itself.` },
        { status: 400 },
      );
    }
    const foreign = ids.filter((id) => !byId.get(id)!.ours);
    if (confirm && foreign.length > 0 && !includeForeign) {
      return NextResponse.json(
        {
          error:
            `Refused: ${foreign.map((id) => `“${byId.get(id)!.name}”`).join(", ")} were not created by the portal. ` +
            "Tick the extra confirmation to delete hand-made entries too.",
          foreign: foreign.map((id) => byId.get(id)!.name),
        },
        { status: 409 },
      );
    }

    // Impact assessment against the post-delete state.
    const rawNetworks = await listNetworks();
    const networks: PlanNetwork[] = rawNetworks
      .filter((n) => !(n.purpose ?? "").startsWith("wan"))
      .map((n) => ({ id: n._id, name: n.name, vlan: n.vlan, subnet: n.ip_subnet, isGuest: n.purpose === "guest" }));
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
    const assessment = assessDeletion({
      live: { policies, rules },
      deletedIds: new Set(ids),
      idOf,
      adminIp: clientIp(req) ?? null,
      targetIps,
      networks,
      zones: zbf ? zones : null,
    });

    if (!confirm) {
      return NextResponse.json({
        toDelete: ids.map((id) => byId.get(id)!.name),
        foreign: foreign.map((id) => byId.get(id)!.name),
        ...assessment,
      });
    }
    if (assessment.blocked) {
      return NextResponse.json(
        { error: "Refused: these deletions would cut YOUR session off from the portal.", ...assessment },
        { status: 409 },
      );
    }

    const deleted: string[] = [];
    for (const id of ids) {
      const name = byId.get(id)!.name;
      try {
        if (zbf) await deleteFirewallPolicy(id);
        else await deleteFirewallRule(id);
        deleted.push(name);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        audit(req, {
          actorType: "admin",
          actor: session.sub,
          action: "unifi.firewall.delete",
          target: cfg.unifiSite,
          detail: { deleted, abortedOn: name, error: message.slice(0, 500) },
        });
        return NextResponse.json(
          {
            error: `Controller rejected deleting “${name}”: ${message} — stopped there; ${deleted.length} entr(y/ies) were deleted before the failure.`,
            deleted,
          },
          { status: 502 },
        );
      }
    }

    audit(req, {
      actorType: "admin",
      actor: session.sub,
      action: "unifi.firewall.delete",
      target: cfg.unifiSite,
      detail: { deleted, foreign: foreign.map((id) => byId.get(id)!.name), adminIp: assessment.adminIp },
    });
    return NextResponse.json({ deleted, ...assessment });
  } catch (err) {
    const message = err instanceof Error ? err.message : "UniFi request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
