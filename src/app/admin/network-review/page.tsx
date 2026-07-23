"use client";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Info, ShieldAlert, ShieldCheck, ShieldX, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  assessCriticalAddresses,
  buildFirewallPlan,
  parseCriticalAddresses,
  portalRuleName,
  rangeOf,
  type CriticalAssessment,
  type FirewallRule,
  type PlanNetwork,
} from "@/lib/firewallPlan";
import { assessZbfCritical, buildZbfPlan, type PlannedPolicy, type ZbfZone } from "@/lib/zbfPlan";
import type { PathTestResult } from "@/lib/firewallPathTest";
import { useAdminSettings } from "@/lib/useAdminSettings";
import { SortLabel, useTableSort, type SortAccessors } from "@/components/admin/tableSort";

type Target = { name: string; ip: string };

// Column sorting; the "#" column always restores the true apply order.
const ZBF_PLAN_SORTS: SortAccessors<PlannedPolicy> = {
  order: (p) => p.order,
  action: (p) => p.action,
  proto: (p) => p.protocol,
  source: (p) => p.source.label,
  destination: (p) => p.destination.label,
  port: (p) => p.destination.port,
  policy: (p) => p.name,
};
const CLASSIC_PLAN_SORTS: SortAccessors<FirewallRule> = {
  order: (r) => r.order,
  ruleset: (r) => r.ruleset,
  action: (r) => r.action,
  proto: (r) => r.protocol,
  source: (r) => r.source,
  destination: (r) => r.destination,
  ports: (r) => r.ports,
  description: (r) => r.description,
};
type Recommendation = { id: string; severity: "warning" | "info"; title: string; detail: string };
type LiveRow = {
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

const LIVE_SORTS: SortAccessors<LiveRow> = {
  index: (r) => (r.ruleset ? `${r.ruleset} / ${r.index ?? ""}` : r.index),
  action: (r) => r.action,
  proto: (r) => r.protocol,
  source: (r) => r.source,
  destination: (r) => r.destination,
  port: (r) => r.port ?? "any",
  policy: (r) => r.name,
  tags: (r) =>
    [r.ours ? "portal" : "", r.predefined ? "predefined" : "", r.enabled ? "" : "disabled"]
      .filter(Boolean)
      .join(" "),
};
type DeletePreview = {
  toDelete?: string[];
  foreign?: string[];
  deleted?: string[];
  blocked?: boolean;
  warnings?: string[];
  adminIp?: string | null;
  error?: string;
};
type PciFixItem = {
  name: string;
  /** Critical entries this block's SOURCE covers: flagged and unticked by
   * default; ticking one back on is the operator's explicit choice. */
  criticalHits?: string[];
};
type PciFixPreview = {
  preview?: PciFixItem[];
  unfixable?: string[];
  notes?: string[];
  applied?: string[];
  skipped?: string[];
  blocked?: boolean;
  warnings?: string[];
  adminIp?: string | null;
  critical?: CriticalAssessment | null;
  error?: string;
};
type PciRow = {
  id: string;
  networkId: string;
  networkName: string;
  severity: "pass" | "fail" | "warn" | "info";
  title: string;
  detail: string;
  evidence?: string;
};
type ReviewData = {
  portal: Target;
  proxy: Target | null;
  engine?: string;
  /** Present (non-null) only on zone-based controllers with resolvable zones. */
  zones?: ZbfZone[] | null;
  networks: PlanNetwork[];
  recommendations: Recommendation[];
  /** Adopted devices for the path test's "simulate from this device" pickers. */
  devices?: { mac: string; name: string; ip: string; type: string }[];
  error?: string;
};

type VlanCheck = {
  end: "source" | "destination";
  device: string;
  network: string;
  ok: boolean;
  unknown: boolean;
  blockedAt?: { deviceName: string; portIdx?: number; summary: string };
  hops: string[];
};

type ApplyPreview = {
  blocked: boolean;
  warnings: string[];
  adminIp: string | null;
  engine?: string;
  preview?: unknown[];
  applied?: string[];
  skipped?: string[];
  error?: string;
  critical?: CriticalAssessment | null;
};

// --- Critical-address entry model (mirrors the stored token grammar:
// "addr" = guard-only, "addr@all", or "addr@port[t|u]+…+ping") -------------

type SvcProto = "tcp_udp" | "tcp" | "udp";
type Svc = { port: string; proto: SvcProto };
type AccessMode = "guard" | "services" | "all";

const WELL_KNOWN: { name: string; port: string; proto: SvcProto }[] = [
  { name: "DNS", port: "53", proto: "tcp_udp" },
  { name: "DHCP", port: "67", proto: "udp" },
  { name: "HTTP", port: "80", proto: "tcp" },
  { name: "HTTPS", port: "443", proto: "tcp" },
  { name: "NTP", port: "123", proto: "udp" },
  { name: "SSH", port: "22", proto: "tcp" },
  { name: "RDP", port: "3389", proto: "tcp" },
  { name: "SMB", port: "445", proto: "tcp" },
  { name: "Syslog", port: "514", proto: "udp" },
  { name: "RADIUS", port: "1812", proto: "udp" },
  { name: "Print IPP", port: "631", proto: "tcp" },
  { name: "Print RAW", port: "9100", proto: "tcp" },
];

const protoLabel = (p: SvcProto) => (p === "tcp_udp" ? "tcp+udp" : p);
const svcName = (port: string) => WELL_KNOWN.find((w) => w.port === port)?.name ?? null;
const svcToken = (s: Svc) => `${s.port}${s.proto === "tcp" ? "t" : s.proto === "udp" ? "u" : ""}`;

function parseSpec(spec: string | undefined): { mode: AccessMode; services: Svc[]; ping: boolean } {
  if (spec === undefined) return { mode: "guard", services: [], ping: false };
  if (spec === "all") return { mode: "all", services: [], ping: false };
  const toks = spec.split("+").filter(Boolean);
  const services: Svc[] = [];
  for (const t of toks) {
    const m = /^(\d+)([tu])?$/.exec(t);
    if (m) services.push({ port: m[1], proto: m[2] === "t" ? "tcp" : m[2] === "u" ? "udp" : "tcp_udp" });
  }
  return { mode: "services", services, ping: toks.includes("ping") };
}

function buildToken(addr: string, mode: AccessMode, services: Svc[], ping: boolean): string {
  if (mode === "guard") return addr;
  if (mode === "all") return `${addr}@all`;
  return `${addr}@${[...services.map(svcToken), ...(ping ? ["ping"] : [])].join("+")}`;
}

/** One-line human summary for the list row. */
function summarizeToken(token: string): string {
  const [, spec] = token.split("@") as [string, string | undefined];
  const p = parseSpec(spec);
  if (p.mode === "guard") return "Guard only — protected from being cut off, no allow rules";
  if (p.mode === "all") return "Allow everything — all ports & protocols";
  const parts = p.services.map((s) => {
    const name = svcName(s.port);
    return name ? `${name} ${s.port}/${protoLabel(s.proto)}` : `port ${s.port}/${protoLabel(s.proto)}`;
  });
  if (p.ping) parts.push("ping");
  return `Allow ${parts.join(" · ")}`;
}

/** Roomy add/edit dialog for one critical address. */
function CriticalAddressDialog({
  open,
  token,
  existingAddrs,
  onSave,
  onClose,
}: {
  open: boolean;
  /** Entry being edited, or null to create one. */
  token: string | null;
  /** Addresses of the OTHER entries, for duplicate detection. */
  existingAddrs: string[];
  onSave: (token: string) => void;
  onClose: () => void;
}) {
  const [addr, setAddr] = useState("");
  const [mode, setMode] = useState<AccessMode>("services");
  const [services, setServices] = useState<Svc[]>([]);
  const [ping, setPing] = useState(false);
  const [customPort, setCustomPort] = useState("");
  const [customProto, setCustomProto] = useState<SvcProto>("tcp_udp");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const [a, spec] = (token ?? "").split("@") as [string, string | undefined];
    const p = parseSpec(token === null ? undefined : spec);
    setAddr(token === null ? "" : a);
    // New entries start in "services" with DNS preselected — the common case
    // (a DNS/DHCP server that guests must keep reaching on specific ports).
    setMode(token === null ? "services" : p.mode);
    setServices(token === null ? [{ port: "53", proto: "tcp_udp" }] : p.services);
    setPing(token === null ? false : p.ping);
    setCustomPort("");
    setCustomProto("tcp_udp");
    setErr(null);
  }, [open, token]);

  const togglePreset = (w: (typeof WELL_KNOWN)[number]) =>
    setServices((s) =>
      s.some((x) => x.port === w.port)
        ? s.filter((x) => x.port !== w.port)
        : [...s, { port: w.port, proto: w.proto }],
    );

  const addCustom = () => {
    if (!/^\d{1,5}$/.test(customPort) || Number(customPort) < 1 || Number(customPort) > 65535) {
      setErr("Custom port must be 1–65535.");
      return;
    }
    setErr(null);
    setServices((s) =>
      s.some((x) => x.port === customPort) ? s : [...s, { port: customPort, proto: customProto }],
    );
    setCustomPort("");
  };

  const save = () => {
    const a = addr.trim();
    if (!rangeOf(a)) {
      setErr(`"${a || "(empty)"}" is not an IPv4 address or CIDR.`);
      return;
    }
    if (existingAddrs.includes(a.split("/")[0]) || existingAddrs.includes(a)) {
      setErr(`${a} is already on the list — edit that entry instead.`);
      return;
    }
    if (mode === "services" && services.length === 0 && !ping) {
      setErr("Pick at least one service (or ping), or switch to another access mode.");
      return;
    }
    onSave(buildToken(a, mode, services, ping));
    onClose();
  };

  const modeOption = (value: AccessMode, title: string, hint: string) => (
    <label
      className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 ${mode === value ? "border-primary bg-muted/50" : ""}`}
    >
      <input
        type="radio"
        name="critical-access-mode"
        className="mt-0.5"
        checked={mode === value}
        onChange={() => setMode(value)}
      />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{token ? "Edit critical address" : "Add critical address"}</DialogTitle>
          <DialogDescription>
            Critical addresses can never be cut off by an apply. Optionally they also get allow
            policies written above the blocks, so guests keep reaching them.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>IP address or subnet</Label>
            <Input
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder="10.0.20.5 or 10.0.20.0/24"
              className="font-mono"
              disabled={token !== null}
            />
          </div>
          <div className="grid gap-2">
            {modeOption("services", "Allow selected services", "Guests reach only the ports you pick — right for DNS, DHCP, printers.")}
            {modeOption("all", "Allow everything", "All ports and protocols from every guest network. Use sparingly.")}
            {modeOption("guard", "Guard only", "No allow rules — just refuse any apply that would cut this address off.")}
          </div>
          {mode === "services" && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="space-y-1.5">
                <Label>Common services</Label>
                <div className="flex flex-wrap gap-1.5">
                  {WELL_KNOWN.map((w) => {
                    const active = services.some((s) => s.port === w.port);
                    return (
                      <button
                        key={w.port}
                        type="button"
                        onClick={() => togglePreset(w)}
                        className={`rounded-full border px-2.5 py-1 text-xs ${
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "bg-background hover:bg-muted"
                        }`}
                        aria-pressed={active}
                      >
                        {w.name} {w.port}
                      </button>
                    );
                  })}
                </div>
              </div>
              {services.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Selected — pick the protocol per service</Label>
                  <div className="divide-y rounded-md border">
                    {services.map((s) => (
                      <div key={s.port} className="flex items-center gap-2 p-2 text-sm">
                        <span className="min-w-0 flex-1">
                          {svcName(s.port) ?? "Custom"} <span className="font-mono text-xs text-muted-foreground">:{s.port}</span>
                        </span>
                        <select
                          value={s.proto}
                          onChange={(e) =>
                            setServices((list) =>
                              list.map((x) => (x.port === s.port ? { ...x, proto: e.target.value as SvcProto } : x)),
                            )
                          }
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                          aria-label={`Protocol for port ${s.port}`}
                        >
                          <option value="tcp_udp">tcp + udp</option>
                          <option value="tcp">tcp only</option>
                          <option value="udp">udp only</option>
                        </select>
                        <button
                          type="button"
                          className="px-1 text-muted-foreground hover:text-destructive"
                          onClick={() => setServices((list) => list.filter((x) => x.port !== s.port))}
                          aria-label={`Remove port ${s.port}`}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Custom port</Label>
                <div className="flex gap-2">
                  <Input
                    value={customPort}
                    onChange={(e) => setCustomPort(e.target.value.replace(/[^0-9]/g, ""))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCustom();
                      }
                    }}
                    placeholder="8443"
                    className="w-28 font-mono"
                  />
                  <select
                    value={customProto}
                    onChange={(e) => setCustomProto(e.target.value as SvcProto)}
                    className="h-10 rounded-md border border-input bg-background px-2 text-sm"
                    aria-label="Custom port protocol"
                  >
                    <option value="tcp_udp">tcp + udp</option>
                    <option value="tcp">tcp only</option>
                    <option value="udp">udp only</option>
                  </select>
                  <Button type="button" variant="outline" onClick={addCustom}>
                    Add port
                  </Button>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={ping} onChange={(e) => setPing(e.target.checked)} />
                Also allow ping (ICMP)
              </label>
            </div>
          )}
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={save}>
            {token ? "Update entry" : "Add entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function NetworkReviewPage() {
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyPreview, setApplyPreview] = useState<ApplyPreview | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyPreview | null>(null);
  // Critical addresses live in SystemSettings — the settings hook keeps this
  // page's edits and the apply route's saved copy in sync.
  const { settings, set: setSetting, save: saveSettings, saving: savingSettings, dirty: settingsDirty } =
    useAdminSettings();
  const [criticalMsg, setCriticalMsg] = useState<string | null>(null);
  const [criticalDialogOpen, setCriticalDialogOpen] = useState(false);
  /** Entry token being edited in the dialog; null = adding a new one. */
  const [criticalEditing, setCriticalEditing] = useState<string | null>(null);

  const criticalList = useMemo(
    () => settings.criticalAddresses.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean),
    [settings.criticalAddresses],
  );
  const parsedCritical = useMemo(
    () => parseCriticalAddresses(settings.criticalAddresses),
    [settings.criticalAddresses],
  );
  const criticalAllows = useMemo(
    () => parsedCritical.entries.filter((e) => e.allow),
    [parsedCritical],
  );

  const removeCritical = (addr: string) =>
    setSetting("criticalAddresses", criticalList.filter((t) => t.split("@")[0] !== addr).join(", "));

  /** Dialog save: replace the edited entry (or any entry for the same
   * address), else append. */
  const upsertCritical = (tok: string) => {
    const addr = tok.split("@")[0];
    const editAddr = criticalEditing?.split("@")[0];
    let replaced = false;
    const next = criticalList
      .map((t) => {
        const a = t.split("@")[0];
        if (a === addr || (editAddr && a === editAddr)) {
          if (replaced) return null;
          replaced = true;
          return tok;
        }
        return t;
      })
      .filter((t): t is string => t !== null);
    setSetting("criticalAddresses", (replaced ? next : [...next, tok]).join(", "));
  };

  const saveCritical = async () => {
    const ok = await saveSettings();
    setCriticalMsg(ok ? "Saved." : "Failed to save the critical-address list.");
  };

  useEffect(() => {
    fetch("/api/admin/unifi/review")
      .then((r) => r.json())
      .then((d: ReviewData) => {
        setData(d);
        // Default-tick guest networks — the common intent (guests reach the
        // portal, nothing else).
        if (d.networks) setSelected(new Set(d.networks.filter((n) => n.isGuest).map((n) => n.id)));
      })
      .catch(() => setData({ error: "Could not load the network review." } as ReviewData))
      .finally(() => setLoading(false));
  }, []);

  const zbf = !!data?.zones?.length;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const toggleAll = (ids: string[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      for (const id of ids) on ? n.add(id) : n.delete(id);
      return n;
    });

  // Picker groups: one section per zone on ZBF controllers (plus a leftover
  // group for networks the controller has not zoned), a single flat group on
  // classic ones.
  const pickerGroups = useMemo(() => {
    if (!data?.networks) return [];
    if (!data.zones?.length) return [{ key: "all", title: null as string | null, nets: data.networks }];
    const groups = data.zones
      .map((z) => ({
        key: z.id,
        title: `Zone “${z.name}”`,
        nets: data.networks.filter((n) => z.networkIds.includes(n.id)),
      }))
      .filter((g) => g.nets.length > 0);
    const zoned = new Set(groups.flatMap((g) => g.nets.map((n) => n.id)));
    const unzoned = data.networks.filter((n) => !zoned.has(n.id));
    if (unzoned.length > 0) groups.push({ key: "unzoned", title: "Not in any zone", nets: unzoned });
    return groups;
  }, [data]);

  const zbfPlan = useMemo(() => {
    if (!data?.networks || !data.zones?.length) return null;
    const chosen = data.networks.filter((n) => selected.has(n.id));
    return buildZbfPlan(chosen, data.portal, data.proxy, data.networks, data.zones, criticalAllows);
  }, [data, selected, criticalAllows]);

  const classicPlan = useMemo(() => {
    if (!data?.networks || data.zones?.length) return null;
    const chosen = data.networks.filter((n) => selected.has(n.id));
    const guests = data.networks.filter((n) => n.isGuest);
    return buildFirewallPlan(chosen, data.portal, data.proxy, guests, data.networks, criticalAllows);
  }, [data, selected, criticalAllows]);

  const planCount = zbfPlan ? zbfPlan.policies.length : classicPlan ? classicPlan.rules.length : 0;
  const planNotes = zbfPlan ? zbfPlan.notes : classicPlan ? classicPlan.notes : [];
  const zbfPlanT = useTableSort(zbfPlan?.policies ?? [], ZBF_PLAN_SORTS);
  const classicPlanT = useTableSort(classicPlan?.rules ?? [], CLASSIC_PLAN_SORTS);

  // Names the CURRENT plan would write — a portal-created live entry whose
  // name is no longer produced by the plan is "stale" (safe cleanup fodder).
  const plannedNames = useMemo(() => {
    const names = new Set<string>();
    if (zbfPlan) for (const p of zbfPlan.policies) names.add(portalRuleName(p.name, p.destination.port));
    if (classicPlan) {
      for (const r of classicPlan.rules) {
        const ports = r.ports === "-" ? [undefined] : r.ports.split(",").map((p) => p.trim());
        for (const port of ports) names.add(portalRuleName(r.description, port));
      }
    }
    return names;
  }, [zbfPlan, classicPlan]);
  const isStale = (row: LiveRow) => row.ours && !plannedNames.has(row.name);

  // Live verdicts for the box below — same pure assessors the apply route
  // runs server-side, here against the on-screen plan and the EDITED list.
  const criticalPreview = useMemo<CriticalAssessment | null>(() => {
    if (parsedCritical.entries.length === 0) return null;
    if (zbfPlan && data?.zones?.length) {
      return assessZbfCritical(zbfPlan.policies, parsedCritical.entries, data.networks, data.zones);
    }
    if (classicPlan && data) return assessCriticalAddresses(classicPlan.rules, parsedCritical.entries);
    return null;
  }, [zbfPlan, classicPlan, parsedCritical, data]);
  const criticalOf = (addr: string) => criticalPreview?.verdicts.find((v) => v.address === addr);

  // PCI-scoped networks + the read-only segmentation check against the LIVE
  // firewall state (server-side; the plan preview above is irrelevant to it).
  const pciSelected = useMemo(
    () => new Set(settings.pciNetworkIds.split(",").map((t) => t.trim()).filter(Boolean)),
    [settings.pciNetworkIds],
  );
  const togglePci = (id: string) => {
    const next = new Set(pciSelected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSetting("pciNetworkIds", [...next].join(","));
  };
  const [pciRows, setPciRows] = useState<PciRow[] | null>(null);
  const [pciBusy, setPciBusy] = useState(false);
  const [pciError, setPciError] = useState<string | null>(null);
  const [fixOpen, setFixOpen] = useState(false);
  const [fixBusy, setFixBusy] = useState(false);
  const [fixPreview, setFixPreview] = useState<PciFixPreview | null>(null);
  const [fixResult, setFixResult] = useState<PciFixPreview | null>(null);
  const [fixTicked, setFixTicked] = useState<Set<string>>(new Set());
  const toggleFixTicked = (name: string) => {
    setFixTicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  /** Ticked blocks that cover a critical address. Applying those is the
   * operator's explicit call, so the confirm sends acceptCritical. */
  const fixFlaggedTicked = (fixPreview?.preview ?? []).filter(
    (p) => (p.criticalHits?.length ?? 0) > 0 && fixTicked.has(p.name),
  );
  const pciFixable = (pciRows ?? []).some(
    (r) =>
      r.id.startsWith("in-default-") ||
      r.id.startsWith("out-default-") ||
      r.id.startsWith("in-zonedefault-") ||
      r.id.startsWith("out-zonedefault-"),
  );
  const openPciFix = async () => {
    setFixBusy(true);
    setFixPreview(null);
    setFixResult(null);
    setFixOpen(true);
    try {
      const res = await fetch("/api/admin/unifi/review/pci", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const d: PciFixPreview = await res.json();
      setFixPreview(d);
      // Everything starts ticked except blocks that would cut a critical
      // address off; those start unticked and ticking them is a choice.
      setFixTicked(
        new Set((d.preview ?? []).filter((p) => (p.criticalHits?.length ?? 0) === 0).map((p) => p.name)),
      );
    } catch {
      setFixPreview({ blocked: true, warnings: ["Network error — could not reach the PCI fix endpoint."] });
    } finally {
      setFixBusy(false);
    }
  };
  const confirmPciFix = async () => {
    setFixBusy(true);
    try {
      const res = await fetch("/api/admin/unifi/review/pci", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirm: true,
          selected: [...fixTicked],
          acceptCritical: fixFlaggedTicked.length > 0,
        }),
      });
      const d: PciFixPreview = await res.json();
      setFixResult(d);
      if (d.applied?.length) void runPciCheck();
    } catch {
      setFixResult({ error: "Network error while applying fixes." });
    } finally {
      setFixBusy(false);
    }
  };

  // Firewall path test (what-if against the LIVE policies).
  const [ptSrc, setPtSrc] = useState("");
  const [ptSrcNet, setPtSrcNet] = useState("");
  const [ptSrcDev, setPtSrcDev] = useState("");
  const [ptDst, setPtDst] = useState("");
  const [ptDstNet, setPtDstNet] = useState("");
  const [ptDstDev, setPtDstDev] = useState("");
  const [ptPort, setPtPort] = useState("");
  const [ptProto, setPtProto] = useState("any");
  const [ptBusy, setPtBusy] = useState(false);
  const [ptError, setPtError] = useState<string | null>(null);
  const [ptResult, setPtResult] = useState<(PathTestResult & { vlanChecks?: VlanCheck[] }) | null>(null);
  const runPathTest = async () => {
    setPtBusy(true);
    setPtError(null);
    setPtResult(null);
    try {
      const res = await fetch("/api/admin/unifi/review/path-test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          srcIp: ptSrc,
          dstIp: ptDst,
          port: ptPort || null,
          protocol: ptProto === "any" ? null : ptProto,
          srcNetworkId: ptSrcNet || null,
          dstNetworkId: ptDstNet || null,
          srcDeviceMac: ptSrcDev || null,
          dstDeviceMac: ptDstDev || null,
        }),
      });
      const d = await res.json();
      if (d.error) setPtError(d.error);
      else setPtResult(d);
    } catch {
      setPtError("Network error — could not reach the path-test endpoint.");
    } finally {
      setPtBusy(false);
    }
  };

  // Existing-policy cleanup.
  const [liveRows, setLiveRows] = useState<LiveRow[] | null>(null);
  const liveT = useTableSort(liveRows ?? [], LIVE_SORTS);
  const [liveEngine, setLiveEngine] = useState<string | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [delSelected, setDelSelected] = useState<Set<string>>(new Set());
  const [delOpen, setDelOpen] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [delPreview, setDelPreview] = useState<DeletePreview | null>(null);
  const [delResult, setDelResult] = useState<DeletePreview | null>(null);
  const [includeForeign, setIncludeForeign] = useState(false);

  const loadLive = async () => {
    setLiveBusy(true);
    setLiveError(null);
    setDelSelected(new Set());
    try {
      const res = await fetch("/api/admin/unifi/review/policies");
      const d = await res.json();
      if (d.error || !Array.isArray(d.rows)) {
        setLiveRows(null);
        setLiveError(d.error || "Could not load the current policies.");
      } else {
        setLiveRows(d.rows);
        setLiveEngine(d.engine ?? null);
      }
    } catch {
      setLiveRows(null);
      setLiveError("Network error — could not reach the policies endpoint.");
    } finally {
      setLiveBusy(false);
    }
  };

  const toggleDel = (id: string) =>
    setDelSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const openDelete = async () => {
    setDelBusy(true);
    setDelPreview(null);
    setDelResult(null);
    setIncludeForeign(false);
    setDelOpen(true);
    try {
      const res = await fetch("/api/admin/unifi/review/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [...delSelected] }),
      });
      setDelPreview(await res.json());
    } catch {
      setDelPreview({ blocked: true, warnings: ["Network error — could not reach the delete endpoint."] });
    } finally {
      setDelBusy(false);
    }
  };

  const confirmDelete = async () => {
    setDelBusy(true);
    try {
      const res = await fetch("/api/admin/unifi/review/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [...delSelected], confirm: true, includeForeign }),
      });
      const d: DeletePreview = await res.json();
      setDelResult(d);
      if (d.deleted?.length) void loadLive();
    } catch {
      setDelResult({ error: "Network error while deleting." });
    } finally {
      setDelBusy(false);
    }
  };
  const runPciCheck = async () => {
    setPciBusy(true);
    setPciError(null);
    setPciRows(null);
    try {
      const res = await fetch("/api/admin/unifi/review/pci");
      const d = await res.json();
      if (d.error || !Array.isArray(d.rows)) setPciError(d.error || "The segmentation check failed.");
      else setPciRows(d.rows);
    } catch {
      setPciError("Network error — could not reach the PCI check endpoint.");
    } finally {
      setPciBusy(false);
    }
  };

  const rulesText = useMemo(() => {
    if (zbfPlan) {
      const header = ["Order", "Action", "Protocol", "Source zone", "Source", "Destination zone", "Destination", "Port", "Policy"].join("\t");
      const lines = zbfPlan.policies.map((p) =>
        [p.order, p.action, p.protocol, p.source.zoneName, p.source.label, p.destination.zoneName, p.destination.label, p.destination.port ?? "any", p.name].join("\t"),
      );
      return [header, ...lines].join("\n");
    }
    if (!classicPlan) return "";
    const header = ["Order", "Ruleset", "Action", "Protocol", "Source", "Destination", "Ports", "Description"].join("\t");
    const lines = classicPlan.rules.map((r) =>
      [r.order, r.ruleset, r.action, r.protocol, r.source, r.destination, r.ports, r.description].join("\t"),
    );
    return [header, ...lines].join("\n");
  }, [zbfPlan, classicPlan]);

  const copyRules = () =>
    navigator.clipboard.writeText(rulesText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });

  // Two-step apply: preview (server rebuilds the plan + runs the lockout
  // check against THIS browser's IP) → confirm. A blocked verdict cannot be
  // overridden from the UI — that is the whole point.
  const openApply = async () => {
    setApplyBusy(true);
    setApplyResult(null);
    setApplyPreview(null);
    setApplyOpen(true);
    try {
      const res = await fetch("/api/admin/unifi/review/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ networkIds: [...selected] }),
      });
      setApplyPreview(await res.json());
    } catch {
      setApplyPreview({ blocked: true, warnings: ["Network error — could not reach the apply endpoint."], adminIp: null });
    } finally {
      setApplyBusy(false);
    }
  };

  const confirmApply = async () => {
    setApplyBusy(true);
    try {
      const res = await fetch("/api/admin/unifi/review/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ networkIds: [...selected], confirm: true }),
      });
      setApplyResult(await res.json());
    } catch {
      setApplyResult({ blocked: false, warnings: [], adminIp: null, error: "Network error while applying." });
    } finally {
      setApplyBusy(false);
    }
  };

  if (loading) return <div>Loading…</div>;
  if (data?.error) return <div className="text-destructive">{data.error}</div>;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold">Network Review</h1>
        <p className="text-sm text-muted-foreground">
          Review which networks reach the portal, protect critical addresses, and check the firewall against your policy.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{zbf ? "Firewall policy builder (zone-based)" : "Firewall rule builder"}</CardTitle>
          <CardDescription>
            Tick the networks that should be able to reach the portal
            {data?.proxy ? " and Traefik" : ""}.{" "}
            {zbf ? (
              <>
                The controller runs the zone-based firewall, so the plan is a set of{" "}
                <strong>policies between zones</strong> — reviewable here, copyable, or pushed with{" "}
                <strong>Apply to UniFi</strong> (Settings → Policy Engine)
              </>
            ) : (
              <>
                The rule set can be copied and applied <strong>by hand</strong> in the UniFi console
                (Settings → Firewall &amp; Security), or pushed with <strong>Apply to UniFi</strong>
              </>
            )}
            {" — "}applying first checks <em>your own IP</em> against every block and refuses outright
            if it would cut your session off.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border p-3 text-sm">
            <p className="mb-1 font-medium">Targets</p>
            <p className="text-muted-foreground">
              Portal: <span className="font-mono">{data?.portal.ip || "— set Proxy Target IP in Settings → URLs"}</span>
              {data?.proxy && <> · Traefik: <span className="font-mono">{data.proxy.ip}</span></>}
              {data?.engine && <> · <span className="font-mono">{data.engine}</span> firewall</>}
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">Networks allowed to reach the target(s)</p>
            <div className="rounded-md border divide-y">
              {pickerGroups.map((g) => (
                <div key={g.key} className="divide-y">
                  {g.title && (
                    <label className="flex items-center gap-3 bg-muted/50 p-2.5 text-sm">
                      {g.key !== "unzoned" ? (
                        <input
                          type="checkbox"
                          checked={g.nets.every((n) => selected.has(n.id))}
                          onChange={(e) => toggleAll(g.nets.map((n) => n.id), e.target.checked)}
                        />
                      ) : (
                        <span className="w-[13px]" />
                      )}
                      <span className="font-medium">{g.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {g.key === "unzoned"
                          ? "these networks belong to no firewall zone — policies for them must be added by hand"
                          : `${g.nets.length} network(s)`}
                      </span>
                    </label>
                  )}
                  {g.nets.map((n) => (
                    <label key={n.id} className={`flex items-center gap-3 p-2.5 text-sm ${g.title ? "pl-8" : ""}`}>
                      <input type="checkbox" checked={selected.has(n.id)} onChange={() => toggle(n.id)} />
                      <span className="font-medium">{n.name}</span>
                      {n.vlan != null && <span className="text-xs text-muted-foreground">VLAN {n.vlan}</span>}
                      {n.isGuest && <span className="rounded bg-amber-500/15 px-1.5 text-xs text-amber-700 dark:text-amber-400">guest</span>}
                      <span className="ml-auto font-mono text-xs text-muted-foreground">{n.subnet ?? "no subnet"}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {planCount > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {zbf ? `Policies to apply (${planCount})` : `Rule set to apply (${planCount})`}
                </p>
                <span className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={copyRules}>
                    {copied ? "Copied!" : "Copy as TSV"}
                  </Button>
                  <Button type="button" size="sm" onClick={() => void openApply()}>
                    <Zap className="mr-1 h-3.5 w-3.5" /> Apply to UniFi…
                  </Button>
                </span>
              </div>
              <div className="overflow-x-auto rounded-md border">
                {zbfPlan ? (
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 text-left">
                      <tr>
                        <th className="p-2"><SortLabel label="#" k="order" sort={zbfPlanT.sort} onToggle={zbfPlanT.toggle} /></th>
                        <th className="p-2"><SortLabel label="Action" k="action" sort={zbfPlanT.sort} onToggle={zbfPlanT.toggle} /></th>
                        <th className="p-2"><SortLabel label="Proto" k="proto" sort={zbfPlanT.sort} onToggle={zbfPlanT.toggle} /></th>
                        <th className="p-2"><SortLabel label="Source" k="source" sort={zbfPlanT.sort} onToggle={zbfPlanT.toggle} /></th>
                        <th className="p-2"><SortLabel label="Destination" k="destination" sort={zbfPlanT.sort} onToggle={zbfPlanT.toggle} /></th>
                        <th className="p-2"><SortLabel label="Port" k="port" sort={zbfPlanT.sort} onToggle={zbfPlanT.toggle} /></th>
                        <th className="p-2"><SortLabel label="Policy" k="policy" sort={zbfPlanT.sort} onToggle={zbfPlanT.toggle} /></th>
                      </tr>
                    </thead>
                    <tbody>
                      {zbfPlanT.sorted.map((p) => (
                        <tr key={p.order} className="border-t">
                          <td className="p-2">{p.order}</td>
                          <td className={`p-2 font-medium ${p.action === "BLOCK" ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>{p.action}</td>
                          <td className="p-2">{p.protocol}</td>
                          <td className="p-2">
                            <span className="font-mono">{p.source.label}</span>
                            {!p.source.label.startsWith("zone") && (
                              <span className="ml-1 text-muted-foreground">({p.source.zoneName})</span>
                            )}
                          </td>
                          <td className="p-2">
                            <span className="font-mono">{p.destination.label}</span>
                            {!p.destination.label.startsWith("zone") && (
                              <span className="ml-1 text-muted-foreground">({p.destination.zoneName})</span>
                            )}
                          </td>
                          <td className="p-2">{p.destination.port ?? "any"}</td>
                          <td className="p-2">{p.name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 text-left">
                      <tr>
                        <th className="p-2"><SortLabel label="#" k="order" sort={classicPlanT.sort} onToggle={classicPlanT.toggle} /></th>
                        <th className="p-2"><SortLabel label="Ruleset" k="ruleset" sort={classicPlanT.sort} onToggle={classicPlanT.toggle} /></th>
                        <th className="p-2"><SortLabel label="Action" k="action" sort={classicPlanT.sort} onToggle={classicPlanT.toggle} /></th>
                        <th className="p-2"><SortLabel label="Proto" k="proto" sort={classicPlanT.sort} onToggle={classicPlanT.toggle} /></th>
                        <th className="p-2"><SortLabel label="Source" k="source" sort={classicPlanT.sort} onToggle={classicPlanT.toggle} /></th>
                        <th className="p-2"><SortLabel label="Destination" k="destination" sort={classicPlanT.sort} onToggle={classicPlanT.toggle} /></th>
                        <th className="p-2"><SortLabel label="Ports" k="ports" sort={classicPlanT.sort} onToggle={classicPlanT.toggle} /></th>
                        <th className="p-2"><SortLabel label="Description" k="description" sort={classicPlanT.sort} onToggle={classicPlanT.toggle} /></th>
                      </tr>
                    </thead>
                    <tbody>
                      {classicPlanT.sorted.map((r) => (
                        <tr key={r.order} className="border-t">
                          <td className="p-2">{r.order}</td>
                          <td className="p-2 font-mono">{r.ruleset}</td>
                          <td className={`p-2 font-medium ${r.action === "drop" ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>{r.action}</td>
                          <td className="p-2">{r.protocol}</td>
                          <td className="p-2 font-mono">{r.source}</td>
                          <td className="p-2 font-mono">{r.destination}</td>
                          <td className="p-2">{r.ports}</td>
                          <td className="p-2">{r.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
          {planNotes.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {planNotes.map((note, i) => (
                <li key={i} className="flex gap-1.5"><span>•</span>{note}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Critical addresses</CardTitle>
          <CardDescription>
            Infrastructure that must stay reachable — DNS and DHCP servers, POS terminals, door
            controllers. Entries with <strong>allow through firewall</strong> get ALLOW policies
            above the blocks (all ports, or just the ones you list), written on the next apply.
            Every apply is also guarded: a plan whose blocks would cut an entry off is{" "}
            <strong>refused outright</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {criticalList.length > 0 ? (
            <div className="divide-y rounded-md border">
              {criticalList.map((token) => {
                const [addr] = token.split("@");
                const v = criticalOf(token);
                return (
                  <div key={addr} className="flex items-center gap-3 p-2.5 text-sm">
                    {v?.status === "cut-off" ? (
                      <ShieldX aria-label="Would be cut off" className="h-4 w-4 shrink-0 text-destructive" />
                    ) : v?.status === "blocked-to" ? (
                      <ShieldAlert aria-label="Blocks point at it" className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    ) : (
                      <ShieldCheck aria-label="Safe" className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p>
                        <span className="font-mono font-medium">{addr}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{summarizeToken(token)}</span>
                      </p>
                      {v && v.status !== "safe" && (
                        <p className="text-xs text-muted-foreground">{v.detail}</p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCriticalEditing(token);
                        setCriticalDialogOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                    <button
                      type="button"
                      className="px-1 text-muted-foreground hover:text-destructive"
                      onClick={() => removeCritical(addr)}
                      aria-label={`Remove ${addr}`}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No critical addresses yet — add your DNS and DHCP servers first.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCriticalEditing(null);
                setCriticalDialogOpen(true);
              }}
            >
              Add address…
            </Button>
            <Button type="button" onClick={() => void saveCritical()} disabled={savingSettings || !settingsDirty}>
              {savingSettings ? "Saving…" : "Save list"}
            </Button>
          </div>
          {criticalMsg && <p className="text-xs text-muted-foreground">{criticalMsg}</p>}
          {settingsDirty && (
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
              ⚠ Unsaved changes — the apply guard uses the last SAVED list.
            </p>
          )}
          <CriticalAddressDialog
            open={criticalDialogOpen}
            token={criticalEditing}
            existingAddrs={criticalList
              .map((t) => t.split("@")[0])
              .filter((a) => a !== criticalEditing?.split("@")[0])}
            onSave={upsertCritical}
            onClose={() => setCriticalDialogOpen(false)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>PCI / Point-of-Sale segmentation</CardTitle>
          <CardDescription>
            Mark the network(s) that carry payment traffic, then verify the <strong>live</strong>{" "}
            firewall actually isolates them: nothing reaches a PCI network except enumerated
            services, and its own egress is restricted. Read-only — evidence for an assessor,
            not a certification.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border divide-y">
            {(data?.networks ?? []).map((n) => (
              <label key={n.id} className="flex items-center gap-3 p-2.5 text-sm">
                <input type="checkbox" checked={pciSelected.has(n.id)} onChange={() => togglePci(n.id)} />
                <span className="font-medium">{n.name}</span>
                {n.vlan != null && <span className="text-xs text-muted-foreground">VLAN {n.vlan}</span>}
                {pciSelected.has(n.id) && (
                  <span className="rounded bg-sky-500/15 px-1.5 text-xs text-sky-700 dark:text-sky-400">PCI-scoped</span>
                )}
                <span className="ml-auto font-mono text-xs text-muted-foreground">{n.subnet ?? "no subnet"}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={() => void saveSettings()} disabled={savingSettings || !settingsDirty}>
              {savingSettings ? "Saving…" : "Save PCI networks"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void runPciCheck()}
              disabled={pciBusy || pciSelected.size === 0}
            >
              {pciBusy ? "Checking…" : "Verify segmentation"}
            </Button>
            {pciFixable && (
              <Button type="button" onClick={() => void openPciFix()} disabled={fixBusy}>
                Apply fixes…
              </Button>
            )}
          </div>
          {settingsDirty && (
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
              ⚠ Unsaved changes — the check runs against the last SAVED selection.
            </p>
          )}
          {pciError && (
            <p className="break-all rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
              {pciError}
            </p>
          )}
          {pciRows && pciRows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No PCI networks saved — tick the POS network(s), save, then verify.
            </p>
          )}
          {pciRows && pciRows.length > 0 && (
            <ul className="space-y-3">
              {pciRows.map((r) => (
                <li key={r.id} className="flex items-start gap-2.5">
                  {r.severity === "pass" ? (
                    <ShieldCheck aria-label="Pass" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : r.severity === "fail" ? (
                    <ShieldX aria-label="Fail" className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  ) : r.severity === "warn" ? (
                    <AlertTriangle aria-label="Warning" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  ) : (
                    <Info aria-label="Info" className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
                  )}
                  <div>
                    <p className="text-sm font-medium">{r.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.detail}
                      {r.evidence && (
                        <>
                          {" "}
                          Evidence: <span className="font-mono">{r.evidence}</span>
                        </>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Dialog open={fixOpen} onOpenChange={(o) => !o && setFixOpen(false)}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Apply PCI segmentation fixes</DialogTitle>
                <DialogDescription>
                  Writes an explicit BLOCK for every flow that currently falls through to the
                  default action. Zone-mixing and broad allows cannot be fixed by adding
                  policies — they stay listed with what to do instead. Untick any block you
                  don&rsquo;t want; blocks that would cut a critical address off start unticked.
                  Only severing your own session is refused outright.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                {fixBusy && !fixPreview && <p>Planning…</p>}
                {fixPreview && !fixResult && (
                  <>
                    {!!fixPreview.preview?.length && (
                      <div className="text-xs">
                        <p className="font-medium">
                          Policies to create ({fixTicked.size} of {fixPreview.preview.length} ticked):
                        </p>
                        <ul className="space-y-1 pt-1">
                          {fixPreview.preview.map((p) => (
                            <li key={p.name}>
                              <label className="flex items-start gap-2">
                                <input
                                  type="checkbox"
                                  className="mt-0.5"
                                  checked={fixTicked.has(p.name)}
                                  onChange={() => toggleFixTicked(p.name)}
                                />
                                <span className="text-muted-foreground">
                                  {p.name}
                                  {!!p.criticalHits?.length && (
                                    <span className="block text-amber-700 dark:text-amber-400">
                                      covers critical {p.criticalHits.join(", ")} in its source — that
                                      device loses its path to the blocked destination. Unticked by
                                      default; tick to block anyway.
                                    </span>
                                  )}
                                </span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <ul className="space-y-1.5">
                      {(fixPreview.warnings ?? []).map((w, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs">
                          {fixPreview.blocked && w.startsWith("REFUSED") ? (
                            <ShieldX className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                          ) : w.startsWith("Lockout check passed") ? (
                            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                          )}
                          <span>{w}</span>
                        </li>
                      ))}
                    </ul>
                    {fixPreview.critical && (
                      <ul className="space-y-1.5">
                        {/* cut-off entries are carried by the flagged (unticked)
                            checkbox rows above; only the advisory ones list here */}
                        {fixPreview.critical.verdicts
                          .filter((v) => v.status === "blocked-to")
                          .map((v) => (
                            <li key={v.address} className="flex items-start gap-1.5 text-xs">
                              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                              <span>
                                <span className="font-mono">{v.address}</span> — {v.detail}
                              </span>
                            </li>
                          ))}
                      </ul>
                    )}
                    {!!fixPreview.notes?.length && (
                      <ul className="space-y-1 text-xs text-muted-foreground">
                        {fixPreview.notes.map((n, i) => (
                          <li key={i} className="flex gap-1.5"><span>•</span>{n}</li>
                        ))}
                      </ul>
                    )}
                    {!!fixPreview.unfixable?.length && (
                      <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                        <p className="font-medium">Needs fixing by hand:</p>
                        <ul className="list-disc pl-4">
                          {fixPreview.unfixable.map((u, i) => (
                            <li key={i}>{u}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {fixPreview.blocked && (
                      <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                        Applying is refused — these blocks would sever your own session. Apply
                        from a network that keeps access, then try again.
                      </p>
                    )}
                    {fixFlaggedTicked.length > 0 && (
                      <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                        {fixFlaggedTicked.length === 1 ? "A ticked block covers" : `${fixFlaggedTicked.length} ticked blocks cover`}{" "}
                        a critical address in the source — applying cuts that device off from
                        the blocked destination. Your call; untick to spare it.
                      </p>
                    )}
                    {fixPreview.error && (
                      <p className="break-all rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                        {fixPreview.error}
                      </p>
                    )}
                  </>
                )}
                {fixResult && (
                  <div className="space-y-2 text-xs">
                    {fixResult.error ? (
                      <p className="break-all rounded-md border border-destructive/50 bg-destructive/10 p-2 text-destructive">
                        {fixResult.error}
                      </p>
                    ) : (
                      <p className="rounded-md border border-emerald-500/50 bg-emerald-500/10 p-2 text-emerald-700 dark:text-emerald-400">
                        Applied {fixResult.applied?.length ?? 0} polic{(fixResult.applied?.length ?? 0) === 1 ? "y" : "ies"}
                        {fixResult.skipped?.length ? `, skipped ${fixResult.skipped.length} already present` : ""}.
                        The check re-runs automatically.
                      </p>
                    )}
                    {!!fixResult.applied?.length && (
                      <ul className="list-disc pl-4 text-muted-foreground">
                        {fixResult.applied.map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setFixOpen(false)}>
                  {fixResult ? "Close" : "Cancel"}
                </Button>
                {!fixResult && (
                  <Button
                    type="button"
                    disabled={
                      fixBusy ||
                      !fixPreview ||
                      fixPreview.blocked ||
                      !!fixPreview.error ||
                      fixTicked.size === 0
                    }
                    onClick={() => void confirmPciFix()}
                  >
                    {fixBusy && fixPreview ? "Applying…" : `Apply ${fixTicked.size} fix(es)`}
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Firewall path test</CardTitle>
          <CardDescription>
            What-if against the <strong>live</strong> firewall: &ldquo;a host with this IP on this
            network talks to that IP — allowed or blocked?&rdquo; Uses the same first-match walk
            the controller applies. Pick a device (e.g. an AP) for an endpoint and its uplink
            chain is also checked for VLAN transport — a trunk port dropping the VLAN shows up
            here. A public IP (or the Internet option) tests LAN↔WAN flows. Models the policy
            table only, not NAT or routing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Source</p>
              <select
                value={ptSrcDev}
                onChange={(e) => {
                  setPtSrcDev(e.target.value);
                  const d = data?.devices?.find((x) => x.mac === e.target.value);
                  if (d) {
                    setPtSrc(d.ip);
                    setPtSrcNet("");
                  }
                }}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                <option value="">device: none (type an IP below)</option>
                {(data?.devices ?? []).map((d) => (
                  <option key={d.mac} value={d.mac}>from {d.name} ({d.ip})</option>
                ))}
              </select>
              <Input
                value={ptSrc}
                onChange={(e) => {
                  setPtSrc(e.target.value);
                  setPtSrcDev("");
                }}
                placeholder="10.91.0.23"
                className="font-mono"
              />
              <select
                value={ptSrcNet}
                onChange={(e) => setPtSrcNet(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                <option value="">network: auto-detect from IP</option>
                <option value="internet">Internet / WAN</option>
                {(data?.networks ?? []).map((n) => (
                  <option key={n.id} value={n.id}>on {n.name}{n.subnet ? ` (${n.subnet})` : ""}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Destination</p>
              <select
                value={ptDstDev}
                onChange={(e) => {
                  setPtDstDev(e.target.value);
                  const d = data?.devices?.find((x) => x.mac === e.target.value);
                  if (d) {
                    setPtDst(d.ip);
                    setPtDstNet("");
                  }
                }}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                <option value="">device: none (type an IP below)</option>
                {(data?.devices ?? []).map((d) => (
                  <option key={d.mac} value={d.mac}>to {d.name} ({d.ip})</option>
                ))}
              </select>
              <Input
                value={ptDst}
                onChange={(e) => {
                  setPtDst(e.target.value);
                  setPtDstDev("");
                }}
                placeholder="10.0.20.5 or 8.8.8.8"
                className="font-mono"
              />
              <select
                value={ptDstNet}
                onChange={(e) => setPtDstNet(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                <option value="">network: auto-detect from IP</option>
                <option value="internet">Internet / WAN</option>
                {(data?.networks ?? []).map((n) => (
                  <option key={n.id} value={n.id}>on {n.name}{n.subnet ? ` (${n.subnet})` : ""}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={ptPort}
              onChange={(e) => setPtPort(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="port (optional)"
              className="w-36 font-mono"
            />
            <select
              value={ptProto}
              onChange={(e) => setPtProto(e.target.value)}
              className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="any">any protocol</option>
              <option value="tcp">tcp</option>
              <option value="udp">udp</option>
            </select>
            <Button type="button" onClick={() => void runPathTest()} disabled={ptBusy || !ptSrc || !ptDst}>
              {ptBusy ? "Testing…" : "Test path"}
            </Button>
          </div>
          {ptError && (
            <p className="break-all rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
              {ptError}
            </p>
          )}
          {ptResult && (
            <div
              className={`rounded-md border p-3 text-sm space-y-2 ${
                ptResult.verdict === "allowed" || ptResult.verdict === "not-firewalled"
                  ? "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400"
                  : ptResult.verdict === "blocked"
                    ? "border-destructive/50 bg-destructive/10 text-destructive"
                    : "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              }`}
            >
              <p className="font-semibold">
                {ptResult.verdict === "allowed"
                  ? "ALLOWED"
                  : ptResult.verdict === "blocked"
                    ? "BLOCKED"
                    : ptResult.verdict === "not-firewalled"
                      ? "Not firewalled — same segment"
                      : ptResult.verdict === "default"
                        ? "No explicit match — the default action decides"
                        : "Cannot evaluate"}
                {ptResult.matched && (
                  <>
                    {" "}by <span className="font-mono text-xs">{ptResult.matched.name}</span>
                  </>
                )}
              </p>
              <p className="text-xs">
                <span className="font-mono">{ptResult.src.ip}</span>
                {ptResult.src.network ? ` — ${ptResult.src.network}` : ""}
                {ptResult.src.zone ? ` (zone ${ptResult.src.zone})` : ""}
                {" → "}
                <span className="font-mono">{ptResult.dst.ip}</span>
                {ptResult.dst.network ? ` — ${ptResult.dst.network}` : ""}
                {ptResult.dst.zone ? ` (zone ${ptResult.dst.zone})` : ""}
              </p>
              {ptResult.partialAllows.length > 0 && (
                <p className="text-xs">
                  Port-specific allows also cover this pair: {ptResult.partialAllows.join("; ")} — retest
                  with a port to see them match.
                </p>
              )}
              {ptResult.notes.map((n, i) => (
                <p key={i} className="text-xs">{n}</p>
              ))}
            </div>
          )}
          {(ptResult?.vlanChecks ?? []).map((v) => (
            <div
              key={v.end}
              className={`rounded-md border p-3 text-xs space-y-1 ${
                !v.ok
                  ? "border-destructive/50 bg-destructive/10 text-destructive"
                  : v.unknown
                    ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                    : "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400"
              }`}
            >
              <p className="font-semibold">
                VLAN transport ({v.end}: {v.device}, {v.network}):{" "}
                {!v.ok
                  ? `BLOCKED at ${v.blockedAt?.deviceName ?? "?"}${v.blockedAt?.portIdx != null ? ` port ${v.blockedAt.portIdx}` : ""}`
                  : v.unknown
                    ? "no hop data to judge"
                    : "carried on every hop"}
              </p>
              {!v.ok && v.blockedAt && (
                <p>That port forwards: {v.blockedAt.summary} — this is the VLAN route problem.</p>
              )}
              {v.hops.length > 0 && <p>Path to gateway: {v.hops.join(" → ")}</p>}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current firewall entries</CardTitle>
          <CardDescription>
            What is on the controller right now. Portal-created entries are tagged; ones the
            current plan no longer produces are <strong>stale</strong> and safe to clean up.
            Deleting is two-step and guarded: hand-made entries need an extra confirmation, and
            deletions that would cut your own session off are refused.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void loadLive()} disabled={liveBusy}>
              {liveBusy ? "Loading…" : liveRows ? "Reload" : "Load current entries"}
            </Button>
            {liveRows && liveRows.some(isStale) && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setDelSelected(new Set(liveRows.filter(isStale).map((r) => r.id)))}
              >
                Select stale portal entries
              </Button>
            )}
            {delSelected.size > 0 && (
              <Button type="button" variant="destructive" onClick={() => void openDelete()}>
                Delete {delSelected.size} selected…
              </Button>
            )}
          </div>
          {liveError && (
            <p className="break-all rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
              {liveError}
            </p>
          )}
          {liveRows && liveRows.length === 0 && (
            <p className="text-sm text-muted-foreground">The controller has no user-visible firewall entries.</p>
          )}
          {liveRows && liveRows.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="p-2" />
                    <th className="p-2">
                      <SortLabel
                        label={liveEngine === "zone-based" ? "Index" : "Ruleset / index"}
                        k="index"
                        sort={liveT.sort}
                        onToggle={liveT.toggle}
                      />
                    </th>
                    <th className="p-2"><SortLabel label="Action" k="action" sort={liveT.sort} onToggle={liveT.toggle} /></th>
                    <th className="p-2"><SortLabel label="Proto" k="proto" sort={liveT.sort} onToggle={liveT.toggle} /></th>
                    <th className="p-2"><SortLabel label="Source" k="source" sort={liveT.sort} onToggle={liveT.toggle} /></th>
                    <th className="p-2"><SortLabel label="Destination" k="destination" sort={liveT.sort} onToggle={liveT.toggle} /></th>
                    <th className="p-2"><SortLabel label="Port" k="port" sort={liveT.sort} onToggle={liveT.toggle} /></th>
                    <th className="p-2"><SortLabel label="Policy" k="policy" sort={liveT.sort} onToggle={liveT.toggle} /></th>
                    <th className="p-2"><SortLabel label="Tags" k="tags" sort={liveT.sort} onToggle={liveT.toggle} /></th>
                  </tr>
                </thead>
                <tbody>
                  {liveT.sorted.map((r) => (
                    <tr key={r.id} className={`border-t ${r.enabled ? "" : "opacity-50"}`}>
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={delSelected.has(r.id)}
                          onChange={() => toggleDel(r.id)}
                          disabled={r.predefined}
                          aria-label={`Select ${r.name}`}
                        />
                      </td>
                      <td className="p-2 font-mono">
                        {r.ruleset ? `${r.ruleset} / ${r.index ?? "—"}` : r.index ?? "—"}
                      </td>
                      <td className={`p-2 font-medium ${/block|drop|reject/i.test(r.action) ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
                        {r.action}
                      </td>
                      <td className="p-2">{r.protocol}</td>
                      <td className="p-2 font-mono">{r.source}</td>
                      <td className="p-2 font-mono">{r.destination}</td>
                      <td className="p-2">{r.port ?? "any"}</td>
                      <td className="p-2">{r.name}</td>
                      <td className="p-2 space-x-1">
                        {r.ours && (
                          <span className="rounded bg-sky-500/15 px-1.5 text-sky-700 dark:text-sky-400">portal</span>
                        )}
                        {isStale(r) && (
                          <span className="rounded bg-amber-500/15 px-1.5 text-amber-700 dark:text-amber-400">stale</span>
                        )}
                        {r.predefined && (
                          <span className="rounded bg-muted px-1.5 text-muted-foreground">predefined</span>
                        )}
                        {!r.enabled && (
                          <span className="rounded bg-muted px-1.5 text-muted-foreground">disabled</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuration health</CardTitle>
          <CardDescription>
            Read-only review of the controller&apos;s configuration and device health against
            common best practices — WLAN security, gateway settings, firmware hygiene,
            segmentation. Nothing here changes the controller — each item is a suggestion to
            action in UniFi.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data && data.recommendations.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="h-4 w-4" /> No issues found in the reviewed configuration.
            </div>
          ) : (
            <ul className="space-y-3">
              {data?.recommendations.map((r) => (
                <li key={r.id} className="flex items-start gap-2.5">
                  {r.severity === "warning" ? (
                    <AlertTriangle aria-label="Warning" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  ) : (
                    <Info aria-label="Info" className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
                  )}
                  <div>
                    <p className="text-sm font-medium">{r.title}</p>
                    <p className="text-xs text-muted-foreground">{r.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={delOpen} onOpenChange={(o) => !o && setDelOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Delete firewall entries</DialogTitle>
            <DialogDescription>
              The impact is assessed server-side first: deleting an allow can hand its traffic to
              a block below it, and deletions that would sever your own session are refused.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {delBusy && !delPreview && <p>Checking…</p>}
            {delPreview && !delResult && (
              <>
                {!!delPreview.toDelete?.length && (
                  <div className="text-xs">
                    <p className="font-medium">To delete ({delPreview.toDelete.length}):</p>
                    <ul className="list-disc pl-4 text-muted-foreground">
                      {delPreview.toDelete.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <ul className="space-y-1.5">
                  {(delPreview.warnings ?? []).map((w, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs">
                      {delPreview.blocked && w.startsWith("REFUSED") ? (
                        <ShieldX className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                      ) : w.startsWith("No remaining block") ? (
                        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                      )}
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
                {!!delPreview.foreign?.length && (
                  <label className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={includeForeign}
                      onChange={(e) => setIncludeForeign(e.target.checked)}
                    />
                    <span>
                      {delPreview.foreign.length} of these ({delPreview.foreign.join(", ")}) were NOT
                      created by the portal — I understand hand-made entries get deleted too.
                    </span>
                  </label>
                )}
                {delPreview.blocked && (
                  <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                    Deleting is refused — it would cut this session off. Deselect the allow(s)
                    shielding your own network and try again.
                  </p>
                )}
                {delPreview.error && (
                  <p className="break-all rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                    {delPreview.error}
                  </p>
                )}
              </>
            )}
            {delResult && (
              <div className="space-y-2 text-xs">
                {delResult.error ? (
                  <p className="break-all rounded-md border border-destructive/50 bg-destructive/10 p-2 text-destructive">
                    {delResult.error}
                  </p>
                ) : (
                  <p className="rounded-md border border-emerald-500/50 bg-emerald-500/10 p-2 text-emerald-700 dark:text-emerald-400">
                    Deleted {delResult.deleted?.length ?? 0} entr{(delResult.deleted?.length ?? 0) === 1 ? "y" : "ies"}.
                  </p>
                )}
                {!!delResult.deleted?.length && (
                  <ul className="list-disc pl-4 text-muted-foreground">
                    {delResult.deleted.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDelOpen(false)}>
              {delResult ? "Close" : "Cancel"}
            </Button>
            {!delResult && (
              <Button
                type="button"
                variant="destructive"
                disabled={
                  delBusy ||
                  !delPreview ||
                  delPreview.blocked ||
                  !!delPreview.error ||
                  (!!delPreview.foreign?.length && !includeForeign)
                }
                onClick={() => void confirmDelete()}
              >
                {delBusy && delPreview ? "Deleting…" : `Delete ${delSelected.size}`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={applyOpen} onOpenChange={(o) => !o && setApplyOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{zbf ? "Apply firewall policies to UniFi" : "Apply firewall rules to UniFi"}</DialogTitle>
            <DialogDescription>
              The plan is rebuilt on the server from live controller data, and your own IP is
              checked against every block before anything is written.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {applyBusy && !applyPreview && <p>Checking…</p>}
            {applyPreview && !applyResult && (
              <>
                <p className="text-xs text-muted-foreground">
                  Your IP: <span className="font-mono">{applyPreview.adminIp ?? "unknown"}</span>
                  {" · "}
                  {(applyPreview.preview?.length ?? 0)} {zbf ? "policy(ies)" : "rule(s)"} to write
                  {applyPreview.engine ? ` · ${applyPreview.engine} firewall` : ""}
                </p>
                <ul className="space-y-1.5">
                  {applyPreview.warnings.map((w, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs">
                      {applyPreview.blocked && w.startsWith("REFUSED") ? (
                        <ShieldX className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                      ) : w.startsWith("Lockout check passed") ? (
                        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                      )}
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
                {applyPreview.critical && (
                  <ul className="space-y-1.5">
                    {applyPreview.critical.verdicts.map((v) => (
                      <li key={v.address} className="flex items-start gap-1.5 text-xs">
                        {v.status === "cut-off" ? (
                          <ShieldX className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                        ) : v.status === "blocked-to" ? (
                          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                        ) : (
                          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        )}
                        <span>
                          <span className="font-mono">{v.address}</span>
                          {v.status === "safe" ? " — safe" : ` — ${v.detail}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {(applyPreview.blocked || applyPreview.critical?.blocked) && (
                  <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                    Applying is refused — it would {applyPreview.critical?.blocked
                      ? "cut a critical address off the network"
                      : "lock this session out"}. Adjust the ticked networks{applyPreview.critical?.blocked
                      ? " or the critical-address list"
                      : " (or apply from another network)"} and try again.
                  </p>
                )}
                {applyPreview.error && (
                  <p className="break-all rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                    {applyPreview.error}
                  </p>
                )}
              </>
            )}
            {applyResult && (
              <div className="space-y-2 text-xs">
                {applyResult.error ? (
                  <p className="break-all rounded-md border border-destructive/50 bg-destructive/10 p-2 text-destructive">
                    {applyResult.error}
                  </p>
                ) : (
                  <p className="rounded-md border border-emerald-500/50 bg-emerald-500/10 p-2 text-emerald-700 dark:text-emerald-400">
                    Applied {applyResult.applied?.length ?? 0} {zbf ? "policy(ies)" : "rule(s)"}
                    {applyResult.skipped?.length
                      ? `, skipped ${applyResult.skipped.length} already present`
                      : ""}
                    . Review them in UniFi → {zbf ? "Settings → Policy Engine" : "Settings → Firewall & Security"}.
                  </p>
                )}
                {!!applyResult.applied?.length && (
                  <ul className="list-disc pl-4 text-muted-foreground">
                    {applyResult.applied.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setApplyOpen(false)}>
              {applyResult ? "Close" : "Cancel"}
            </Button>
            {!applyResult && (
              <Button
                type="button"
                disabled={applyBusy || !applyPreview || applyPreview.blocked || applyPreview.critical?.blocked || !!applyPreview.error || (applyPreview.preview?.length ?? 0) === 0}
                onClick={() => void confirmApply()}
              >
                {applyBusy && applyPreview ? "Applying…" : `Apply ${applyPreview?.preview?.length ?? 0} ${zbf ? "policy(ies)" : "rule(s)"}`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
