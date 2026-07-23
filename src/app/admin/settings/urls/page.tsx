"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, CheckCircle2, Copy, FlaskConical, Plus, RefreshCw, RotateCw, Trash2, TriangleAlert, XCircle } from "lucide-react";
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
import { useAdminSettings } from "@/lib/useAdminSettings";
import { SaveToast, useSaveToast } from "@/components/admin/SaveToast";
import { buildDynamicConfig, toYaml, type ProxyResourceInput } from "@/lib/traefikConfig";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

type Resource = ProxyResourceInput & { id: number; sortOrder: number };

/**
 * Decompose a stored base URL back into subdomain + root domain for the
 * picker; `custom` when it doesn't fit `scheme://sub.rootdomain` (bare IP,
 * foreign domain, other scheme) so the raw input is shown instead.
 */
function splitHost(value: string, scheme: string, domains: string[]) {
  if (!value) return { sub: "", dom: domains[0] ?? "", custom: false };
  const m = value.match(/^([a-z]+):\/\/([a-z0-9.-]+)$/i);
  if (m && m[1].toLowerCase() === scheme) {
    const host = m[2].toLowerCase();
    for (const d of domains) {
      if (host === d) return { sub: "", dom: d, custom: false };
      if (host.endsWith(`.${d}`)) return { sub: host.slice(0, -(d.length + 1)), dom: d, custom: false };
    }
  }
  return { sub: "", dom: domains[0] ?? "", custom: true };
}

/**
 * Portal URL field: subdomain box + base-domain dropdown (domains come from
 * the Proxied Resources → Domains list) composing `scheme://sub.domain` into
 * the setting — no scheme typing. A toggle drops to the raw URL input for
 * bare-IP / off-domain values; with no domains defined it is just the input.
 */
function HostPicker({
  value,
  scheme,
  domains,
  placeholder,
  onChange,
}: {
  value: string;
  scheme: "http" | "https";
  domains: string[];
  placeholder: string;
  onChange: (v: string) => void;
}) {
  const derived = splitHost(value, scheme, domains);
  const [override, setOverride] = useState<boolean | null>(null);
  const custom = domains.length === 0 || (override ?? derived.custom);

  if (custom) {
    return (
      <div className="space-y-1">
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
        {domains.length > 0 && (
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setOverride(false)}>
            pick subdomain + domain instead
          </button>
        )}
      </div>
    );
  }

  const compose = (s: string, d: string) =>
    onChange(s.trim() ? `${scheme}://${s.trim().toLowerCase().replace(/\.+$/, "")}.${d}` : "");
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-muted-foreground">{scheme}://</span>
        <Input
          value={derived.sub}
          onChange={(e) => compose(e.target.value, derived.dom)}
          placeholder="subdomain"
          className="max-w-48"
        />
        <span className="text-sm text-muted-foreground">.</span>
        <select
          className={selectClass}
          value={derived.dom}
          onChange={(e) => compose(derived.sub, e.target.value)}
        >
          {domains.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>
      <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setOverride(true)}>
        enter a custom URL / IP instead
      </button>
    </div>
  );
}

type Check = { name: string; ok: boolean; warn?: boolean; detail: string };

/** ok+!warn = green check, warn = amber triangle, else red cross. */
function CheckRows({ items }: { items: Check[] }) {
  return (
    <div className="rounded-md border p-2 text-xs">
      {items.map((c, i) => (
        <div key={i} className="flex items-start gap-1.5 py-0.5">
          {c.ok && !c.warn && <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />}
          {c.warn && <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />}
          {!c.ok && !c.warn && <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />}
          <span>
            <span className="font-medium">{c.name}</span>
            <span className="text-muted-foreground"> — {c.detail}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// Mirrors SystemHealthReport in src/lib/systemHealth.ts.
type HealthContainer = { name: string; state: string; status: string; image: string; ok: boolean; warn: boolean };
type HealthReport = {
  ok: boolean;
  generatedAt: string;
  split: { mode: string; active: boolean };
  reverseProxyMode: string;
  docker:
    | { available: false; reason: string }
    | { available: true; stale: boolean; generatedAt: string | null; containers: HealthContainer[] };
  checks: Check[];
};

/** Friendly display names for the compose stack's fixed container names. */
function containerLabel(name: string, split: boolean) {
  if (name.endsWith("-traefik-ops")) return "Traefik ops sidecar";
  if (name.endsWith("-traefik")) return "Traefik proxy";
  if (name.endsWith("-db")) return "Database";
  if (name.endsWith("-admin")) return "Portal — admin side";
  return split ? "Portal — guest side" : "Portal";
}

const containerRank = (n: string) =>
  n.endsWith("-admin") ? 1 : n.endsWith("-db") ? 2 : n.endsWith("-traefik-ops") ? 4 : n.endsWith("-traefik") ? 3 : 0;

const imageTag = (img: string) => (img.includes(":") ? img.slice(img.lastIndexOf(":")) : img);

const emptyDraft = {
  name: "",
  // With root domains defined the hostname is subdomain + picked domain;
  // without any, `subdomain` holds a full FQDN (legacy free-text mode).
  subdomain: "",
  domain: "",
  scheme: "http",
  targetHost: "",
  targetPort: "",
  tls: true,
  blockAdminPaths: false,
};

export default function UrlsSettingsPage() {
  const { settings, set, save, loading, saving, dirty } = useAdminSettings();
  const { toast, show, clear } = useSaveToast();
  const [resources, setResources] = useState<Resource[]>([]);
  const [configToken, setConfigToken] = useState("");
  const [adminServiceUrl, setAdminServiceUrl] = useState("");
  const [logdash, setLogdash] = useState<{ host: string; serviceUrl: string } | null>(null);
  const [lastPolled, setLastPolled] = useState<string | null>(null);
  const [lastDenied, setLastDenied] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ ...emptyDraft });
  const [domainDraft, setDomainDraft] = useState("");
  const [resError, setResError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  // Restart-Traefik dialog: fresh password (+TOTP when enrolled) required —
  // the request only drops a marker file; the traefik-ops sidecar (the one
  // container with the docker socket) does the actual restart.
  const [restartOpen, setRestartOpen] = useState(false);
  const [restartPw, setRestartPw] = useState("");
  const [restartCode, setRestartCode] = useState("");
  const [restartNeedCode, setRestartNeedCode] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);
  const [restartMsg, setRestartMsg] = useState<string | null>(null);
  // "Test proxy setup": live probes through Traefik (routing, admin blocks,
  // certs, config polling) from /api/admin/traefik/status.
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<Check[] | null>(null);
  // System Health panel (bottom of the page): docker container status from
  // the traefik-ops sidecar + live guest/admin separation checks.
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [healthErr, setHealthErr] = useState<string | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);

  const loadHealth = useCallback(async () => {
    setHealthBusy(true);
    try {
      const res = await fetch("/api/admin/system-health");
      if (!res.ok) throw new Error(String(res.status));
      setHealth(await res.json());
      setHealthErr(null);
    } catch {
      setHealthErr("Could not load system health — the admin API did not answer.");
    } finally {
      setHealthBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadHealth();
    const t = setInterval(() => void loadHealth(), 30_000);
    return () => clearInterval(t);
  }, [loadHealth]);

  const runProxyTest = async () => {
    setTesting(true);
    setTestResults(null);
    // A server-side test can only see SAVED settings — flag edits in flight.
    const unsavedNote: Check[] = dirty
      ? [{ name: "Unsaved changes", ok: false, warn: true, detail: "this page has edits that are not saved yet — the test used the last saved settings. Save Settings, then test again." }]
      : [];
    try {
      const res = await fetch("/api/admin/traefik/status");
      const data = await res.json().catch(() => null);
      setTestResults([...unsavedNote, ...(data?.checks ?? [{ name: "Test", ok: false, detail: "Bad response" }])]);
    } catch {
      setTestResults([{ name: "Test", ok: false, detail: "Network error" }]);
    } finally {
      setTesting(false);
    }
  };

  const runRestart = async () => {
    setRestartBusy(true);
    setRestartMsg(null);
    try {
      const res = await fetch("/api/admin/traefik/restart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: restartPw, code: restartCode }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setRestartOpen(false);
        setRestartPw("");
        setRestartCode("");
        setRestartNeedCode(false);
        show("Restart requested — Traefik bounces within a few seconds.");
        return;
      }
      setRestartNeedCode(Boolean(data?.needCode));
      setRestartMsg(data?.error ?? "Restart failed");
    } catch {
      setRestartMsg("Network error");
    } finally {
      setRestartBusy(false);
    }
  };

  const loadResources = useCallback(async () => {
    const res = await fetch("/api/admin/proxy-resources");
    const data = await res.json().catch(() => null);
    if (data?.resources) setResources(data.resources);
    if (typeof data?.configToken === "string") setConfigToken(data.configToken);
    if (typeof data?.adminServiceUrl === "string") setAdminServiceUrl(data.adminServiceUrl);
    setLogdash(data?.logdash ?? null);
    setLastPolled(data?.traefikLastPolledAt ?? null);
    setLastDenied(data?.traefikLastDeniedAt ?? null);
    setLastError(data?.traefikLastErrorAt ?? null);
    return data;
  }, []);

  const refreshStatus = async () => {
    setRefreshing(true);
    try {
      const data = await loadResources();
      const polled = data?.traefikLastPolledAt;
      show(
        polled
          ? `Status refreshed — Traefik last fetched config at ${new Date(polled).toLocaleTimeString()}.`
          : "Status refreshed — Traefik hasn't fetched the config yet.",
      );
    } catch {
      show("Refresh failed — could not reach the portal API.", "error");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadResources();
  }, [loadResources]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await save();
    if (ok) {
      // Refresh server-derived values (adminServiceUrl, poll status) so the
      // copy-out snippet reflects the just-saved mode instead of a stale one.
      void loadResources();
      show(
        settings.reverseProxyMode === "bundled"
          ? "Settings saved. Static proxy config (ACME email / Cloudflare token) auto-applies — the traefik-ops sidecar restarts Traefik within seconds."
          : "Settings saved!",
      );
    } else {
      show("Failed to save settings.", "error");
    }
  };

  const rootDomains = settings.proxyRootDomains.split(",").map((d) => d.trim()).filter(Boolean);

  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);
  const autoDetectRan = useRef(false);

  const detectIp = async (manual: boolean) => {
    setDetecting(true);
    if (manual) setDetectMsg(null);
    try {
      const res = await fetch("/api/admin/traefik/detect-ip");
      const data = await res.json().catch(() => null);
      if (data?.ip) {
        set("portalTargetIp", data.ip);
        setDetectMsg(`Detected ${data.ip} from ${data.source} — edit if wrong, then Save settings.`);
      } else if (manual) {
        setDetectMsg(data?.error ?? "Could not detect the IP — enter it manually.");
      }
    } catch {
      if (manual) setDetectMsg("Could not detect the IP — enter it manually.");
    } finally {
      setDetecting(false);
    }
  };

  // Self-detect once when the field is blank; never overwrites a saved value.
  useEffect(() => {
    if (loading || autoDetectRan.current) return;
    autoDetectRan.current = true;
    if (settings.reverseProxyMode !== "none" && !settings.portalTargetIp.trim()) void detectIp(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Domains persist IMMEDIATELY (own save call) — losing them because the
  // page-level Save was never pressed proved too easy in practice.
  const addDomain = async () => {
    const d = domainDraft.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d)) {
      setResError("Enter a bare domain, e.g. example.com");
      return;
    }
    setResError(null);
    setDomainDraft("");
    if (rootDomains.includes(d)) return;
    const next = [...rootDomains, d].join(",");
    set("proxyRootDomains", next);
    const ok = await save({ proxyRootDomains: next });
    show(ok ? `Domain ${d} added and saved.` : "Failed to save the domain list.", ok ? "success" : "error");
  };

  const removeDomain = async (d: string) => {
    const next = rootDomains.filter((x) => x !== d).join(",");
    set("proxyRootDomains", next);
    const ok = await save({ proxyRootDomains: next });
    show(ok ? `Domain ${d} removed.` : "Failed to save the domain list.", ok ? "success" : "error");
  };

  const addResource = async () => {
    setResError(null);
    const sub = draft.subdomain.trim().toLowerCase();
    const domain = draft.domain || rootDomains[0] || "";
    const hostname = rootDomains.length === 0 ? sub : sub ? `${sub}.${domain}` : domain;
    if (!hostname) {
      setResError(rootDomains.length ? "Enter a subdomain (or add the bare domain itself)." : "Enter a hostname.");
      return;
    }
    const host = draft.targetHost.trim();
    if (!host) {
      setResError("Enter the target host or IP.");
      return;
    }
    const port = draft.targetPort.trim();
    if (port && !/^\d{1,5}$/.test(port)) {
      setResError("Port must be a number (1–65535).");
      return;
    }
    const res = await fetch("/api/admin/proxy-resources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: draft.name,
        hostname,
        targetUrl: `${draft.scheme}://${host}${port ? `:${port}` : ""}`,
        tls: draft.tls,
        blockAdminPaths: draft.blockAdminPaths,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setResError(data?.error ?? "Failed to add resource");
      return;
    }
    setDraft({ ...emptyDraft });
    await loadResources();
  };

  const patchResource = async (id: number, patch: Partial<Resource>) => {
    setResError(null);
    const res = await fetch(`/api/admin/proxy-resources/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setResError(data?.error ?? "Failed to update resource");
    }
    await loadResources();
  };

  const deleteResource = async (r: Resource) => {
    if (!confirm(`Remove ${r.hostname}? Traefik drops the route on its next poll.`)) return;
    await fetch(`/api/admin/proxy-resources/${r.id}`, { method: "DELETE" });
    await loadResources();
  };

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  if (loading) return <div>Loading…</div>;

  // Live previews for the copy-out card, built with the same code the
  // /api/traefik/config endpoint uses server-side.
  const dynamicPreview = buildDynamicConfig({
    portalBaseUrl: settings.portalBaseUrl,
    guestBaseUrl: settings.guestBaseUrl,
    adminBaseUrl: settings.adminBaseUrl,
    portalServiceUrl:
      settings.reverseProxyMode === "external" && settings.portalTargetIp
        ? `http://${settings.portalTargetIp}`
        : "http://portal:3000",
    // Server-computed (PORTAL_MODE / ADMIN_UPSTREAM_URL are process env):
    // "" unless this deployment runs the guest/admin split.
    adminServiceUrl,
    resources,
    // Server-computed too (logdash profile + LOGDASH_* env); null when the
    // log dashboard isn't deployed, so the preview matches the live output.
    ...(logdash ? { logdash } : {}),
  });
  const providerSnippet = `# Add to your Traefik STATIC config (then restart it once) — routes update
# live on every poll after that, no further Traefik changes needed.
# The dynamic config below assumes entry points named "web" (:80) and
# "websecure" (:443) and a certificate resolver named "cloudflare" —
# rename them in your static config, or adjust to match, before relying
# on the HTTPS routes.
providers:
  http:
    endpoint: "${adminServiceUrl || `http://${settings.portalTargetIp || "<portal-host>"}`}/api/traefik/config?token=${configToken || "<token>"}"
    pollInterval: "5s"`;

  const traefikStale =
    settings.reverseProxyMode === "bundled" &&
    (!lastPolled || Date.now() - new Date(lastPolled).getTime() > 60_000);
  // A denial newer than the last success = Traefik is polling with a WRONG
  // token (stale traefik.yml / rotated ADMIN_SECRET) — different fix than a
  // stopped container, so it gets its own message.
  const traefikDenied =
    settings.reverseProxyMode === "bundled" &&
    !!lastDenied &&
    (!lastPolled || new Date(lastDenied).getTime() > new Date(lastPolled).getTime());
  const traefikDbTrouble =
    settings.reverseProxyMode === "bundled" &&
    !!lastError &&
    (!lastPolled || new Date(lastError).getTime() > new Date(lastPolled).getTime());

  // System Health banner: red on any hard failure, amber on warnings only.
  // (Container warn implies ok — "health: starting" — so red is simply !ok.)
  const healthContainers = health?.docker.available ? health.docker.containers : [];
  const healthRed =
    !!health &&
    (health.checks.some((c) => !c.ok && !c.warn) || healthContainers.some((c) => !c.ok));
  const healthAmber =
    !!health &&
    !healthRed &&
    (health.checks.some((c) => c.warn || !c.ok) || healthContainers.some((c) => c.warn));

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Portal URLs</CardTitle>
          <CardDescription>The hostnames this portal is reachable on</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Captive Portal URL</Label>
            <HostPicker
              value={settings.portalBaseUrl}
              scheme="http"
              domains={rootDomains}
              placeholder="http://10.90.0.189"
              onChange={(v) => set("portalBaseUrl", v)}
            />
            <p className="text-xs text-muted-foreground">
              Plain HTTP address used by the UniFi captive redirect. Pick a subdomain + base domain
              (domains are managed in Proxied Resources below), or switch to a custom value for a
              bare IP — the proxy&apos;s catch-all route serves an IP without a certificate.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Guest Self-Service URL</Label>
            <HostPicker
              value={settings.guestBaseUrl}
              scheme="https"
              domains={rootDomains}
              placeholder="https://wifi.example.com"
              onChange={(v) => set("guestBaseUrl", v)}
            />
            <p className="text-xs text-muted-foreground">
              Where guests manage their account and devices (login, my-devices, email confirmation) —
              served over HTTPS by the reverse proxy below. Blank = same host as the captive portal.
              When set, the captive host redirects self-service pages here and emailed/manage links
              point here. Admin paths are blocked on this host at the proxy.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Admin URL</Label>
            <HostPicker
              value={settings.adminBaseUrl}
              scheme="https"
              domains={rootDomains}
              placeholder="https://portal-adm.example.com"
              onChange={(v) => set("adminBaseUrl", v)}
            />
            <p className="text-xs text-muted-foreground">
              The HTTPS hostname of this admin interface, served by the reverse proxy below.
              When set, admin pages and APIs answer <strong>only</strong> on this hostname —
              guests probing the captive host get 404s.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Admin access networks (optional)</Label>
            <Input
              value={settings.adminAllowedCidrs}
              onChange={(e) => set("adminAllowedCidrs", e.target.value)}
              placeholder="10.0.20.0/24, 10.90.0.5"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated management IPs/CIDRs allowed to reach the admin surface; blank =
              no restriction. Saving refuses a list that does not include your own address, so
              you cannot lock yourself out.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Success Redirect URL</Label>
            <Input
              value={settings.portalSuccessUrl}
              onChange={(e) => set("portalSuccessUrl", e.target.value)}
              placeholder="https://example.com"
            />
            <p className="text-xs text-muted-foreground">
              Where guests land after a successful captive-portal sign-in. Blank = the controller
              default.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reverse Proxy (Traefik)</CardTitle>
          <CardDescription>
            The portal manages Traefik itself: routes update live via Traefik&apos;s HTTP provider;
            certificates come from Let&apos;s Encrypt via Cloudflare DNS-01.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Mode</Label>
            <select
              className={selectClass}
              value={settings.reverseProxyMode}
              onChange={(e) => set("reverseProxyMode", e.target.value)}
            >
              <option value="bundled">Bundled — the compose stack&apos;s own Traefik container</option>
              <option value="external">External — I already run Traefik elsewhere</option>
              <option value="none">None — portal is reached directly (no HTTPS hostnames)</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Bundled needs <code>COMPOSE_PROFILES=traefik</code> in <code>.env</code> (install.sh setup
              offers this; add it and <code>docker compose up -d</code> to enable later).
            </p>
          </div>

          {settings.reverseProxyMode !== "none" && (
            <div className="space-y-1.5">
              <Label>
                Portal target — this portal&apos;s LAN IP
                {settings.reverseProxyMode === "external" ? " (as your proxy reaches it)" : ""}
              </Label>
              <div className="flex gap-2">
                <Input
                  value={settings.portalTargetIp}
                  onChange={(e) => set("portalTargetIp", e.target.value)}
                  placeholder={settings.reverseProxyMode === "external" ? "10.90.0.189:8080" : "10.90.0.189"}
                  className="max-w-xs"
                />
                <Button type="button" variant="outline" disabled={detecting} onClick={() => void detectIp(true)}>
                  {detecting ? "Detecting…" : "Detect"}
                </Button>
              </div>
              {detectMsg && <p className="text-xs text-muted-foreground">{detectMsg}</p>}
              <p className="text-xs text-muted-foreground">
                {settings.reverseProxyMode === "external" ? (
                  <>
                    Host IP (and published port) of this portal as seen from your Traefik — enable the
                    portal&apos;s <code>ports:</code> mapping in docker-compose.yml so it is reachable.
                    Also feeds the UniFi guest-firewall pre-auth rule when the Captive Portal URL is a
                    hostname.
                  </>
                ) : (
                  <>
                    Auto-detected when blank (edit freely, then Save settings). Needed when the Captive
                    Portal URL is a hostname: UniFi&apos;s guest firewall pre-auth rule wants the
                    portal&apos;s IP — the Hotspot Configuration check on the UniFi tab uses this value.
                  </>
                )}
              </p>
            </div>
          )}

          {settings.reverseProxyMode === "bundled" && (
            <>
              {traefikDenied ? (
                <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                  Traefik IS polling but its token was <strong>rejected</strong> (last denied{" "}
                  {new Date(lastDenied!).toLocaleString()}) — its <code>traefik.yml</code> carries a
                  stale token (typically after a re-setup or a restored database). Click{" "}
                  <strong>Save Settings</strong> here to regenerate the file with the current token;
                  the traefik-ops sidecar restarts Traefik automatically.
                </p>
              ) : traefikDbTrouble ? (
                <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
                  The last Traefik config poll failed server-side (database unavailable at{" "}
                  {new Date(lastError!).toLocaleString()}) — Traefik keeps serving its last-good
                  config; this clears by itself once the database is reachable.
                </p>
              ) : traefikStale ? (
                <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
                  The bundled Traefik hasn&apos;t fetched config{lastPolled ? ` since ${new Date(lastPolled).toLocaleString()}` : " yet"} —
                  check that <code>COMPOSE_PROFILES=traefik</code> is set and the container is
                  running (<code>docker compose ps traefik</code>).
                </p>
              ) : null}
              <div className="space-y-1.5">
                <Label>Let&apos;s Encrypt account email</Label>
                <Input
                  value={settings.acmeEmail}
                  onChange={(e) => set("acmeEmail", e.target.value)}
                  placeholder="ops@example.com"
                />
                <p className="text-xs text-muted-foreground">
                  Receives certificate-expiry notices from Let&apos;s Encrypt. Required before
                  certificates can be issued.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>
                  Cloudflare DNS API token{" "}
                  {settings.cfDnsApiTokenSet && (
                    <span className="text-xs text-muted-foreground">(set — blank keeps it)</span>
                  )}
                </Label>
                <Input
                  type="password"
                  value={settings.cfDnsApiToken}
                  onChange={(e) => set("cfDnsApiToken", e.target.value)}
                  placeholder={settings.cfDnsApiTokenSet ? "••••••••" : "Cloudflare token, Zone → DNS → Edit"}
                />
                <p className="text-xs text-muted-foreground">
                  Zone-scoped token (Zone → DNS → Edit) for the domain of the URLs above — used only
                  for the DNS-01 certificate challenge; stored encrypted, written for Traefik as a
                  root-only file in <code>./traefik/</code>. Changes here and to the email
                  auto-apply: the traefik-ops sidecar restarts Traefik when the config file
                  changes.
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={testing} onClick={() => void runProxyTest()}>
                    <FlaskConical className="mr-1 h-3.5 w-3.5" /> {testing ? "Testing…" : "Test proxy setup"}
                  </Button>
                  <Button type="button" variant="destructive" size="sm" onClick={() => setRestartOpen(true)}>
                    <RotateCw className="mr-1 h-3.5 w-3.5" /> Restart Traefik…
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Restart forces a container restart (e.g. to retry certificate issuance) — the proxy
                  drops for a moment. Requires your password, and your one-time code when 2FA is
                  enrolled.
                </p>
                {testResults && <CheckRows items={testResults} />}
              </div>
            </>
          )}

          {settings.reverseProxyMode === "external" && (
            <>
              <div className="space-y-1.5">
                <Label>Add to your Traefik&apos;s static config</Label>
                <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs">{providerSnippet}</pre>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => copy("snippet", providerSnippet)}>
                    <Copy className="mr-1 h-3.5 w-3.5" />
                    {copied === "snippet" ? "Copied!" : "Copy provider snippet"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => copy("yaml", toYaml({ http: dynamicPreview.http }))}
                  >
                    <Copy className="mr-1 h-3.5 w-3.5" />
                    {copied === "yaml" ? "Copied!" : "Copy routes as YAML (file provider)"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Prefer the provider snippet: your Traefik then follows every change on this page
                  automatically. The YAML copy is a point-in-time export for file-provider setups.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Dynamic config your proxy receives (live preview)</Label>
                <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
                  {toYaml({ http: dynamicPreview.http })}
                </pre>
                <p className="text-xs text-muted-foreground">
                  Built from the URLs above and the proxied resources below — exactly what
                  <code className="mx-1">/api/traefik/config</code> serves to your Traefik.
                </p>
              </div>
              <div className="space-y-2">
                <Button type="button" variant="outline" size="sm" disabled={testing} onClick={() => void runProxyTest()}>
                  <FlaskConical className="mr-1 h-3.5 w-3.5" /> {testing ? "Testing…" : "Test proxy setup"}
                </Button>
                {testResults && <CheckRows items={testResults} />}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {settings.reverseProxyMode !== "none" && (
        <Card>
          <CardHeader>
            <CardTitle>Proxied Resources</CardTitle>
            <CardDescription>
              Extra hostnames served through the same Traefik — other LAN services get HTTPS and a
              clean hostname. Changes go live on Traefik&apos;s next config poll (seconds).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5 rounded-md border p-3">
              <Label>Domains</Label>
              <div className="flex flex-wrap items-center gap-1.5">
                {rootDomains.map((d) => (
                  <span key={d} className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs">
                    {d}
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      title={`Remove ${d}`}
                      onClick={() => void removeDomain(d)}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {rootDomains.length === 0 && (
                  <span className="text-xs text-muted-foreground">No domains yet — add your root domain to compose resource hostnames.</span>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  value={domainDraft}
                  onChange={(e) => setDomainDraft(e.target.value)}
                  placeholder="Root domain (example.com)"
                  className="max-w-xs"
                />
                <Button type="button" variant="outline" size="sm" onClick={() => void addDomain()}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add domain
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Base domains offered in the resource form below. Stored with <em>Save settings</em>.
              </p>
            </div>
            {resources.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                <span className={`min-w-32 text-sm font-medium ${r.enabled ? "" : "line-through opacity-50"}`}>
                  {r.name}
                </span>
                <code className="text-xs">{r.hostname}</code>
                <span className="text-xs text-muted-foreground">→ {r.targetUrl}</span>
                <span className="text-xs text-muted-foreground">
                  {r.tls ? "HTTPS" : "HTTP"}
                  {r.blockAdminPaths ? " · admin blocked" : ""}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={(e) => void patchResource(r.id, { enabled: e.target.checked })}
                    />
                    enabled
                  </label>
                  <Button type="button" variant="ghost" size="sm" onClick={() => void deleteResource(r)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </div>
            ))}
            {resources.length === 0 && (
              <p className="text-xs text-muted-foreground">No extra resources yet.</p>
            )}
            <div className="grid gap-2 rounded-md border border-dashed p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="Name (e.g. Home Assistant)"
                />
                {rootDomains.length > 0 ? (
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={draft.subdomain}
                      onChange={(e) => setDraft((d) => ({ ...d, subdomain: e.target.value }))}
                      placeholder="Subdomain (e.g. ha)"
                    />
                    <span className="text-sm text-muted-foreground">.</span>
                    <select
                      className={selectClass}
                      value={draft.domain || rootDomains[0]}
                      onChange={(e) => setDraft((d) => ({ ...d, domain: e.target.value }))}
                    >
                      {rootDomains.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <Input
                    value={draft.subdomain}
                    onChange={(e) => setDraft((d) => ({ ...d, subdomain: e.target.value }))}
                    placeholder="Hostname (ha.example.com)"
                  />
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-[8rem_1fr_6rem]">
                <select
                  className={selectClass}
                  value={draft.scheme}
                  onChange={(e) => setDraft((d) => ({ ...d, scheme: e.target.value }))}
                >
                  <option value="http">http</option>
                  <option value="https">https</option>
                  <option value="h2c">h2c</option>
                </select>
                <Input
                  value={draft.targetHost}
                  onChange={(e) => setDraft((d) => ({ ...d, targetHost: e.target.value }))}
                  placeholder="Target host or IP (10.90.0.50)"
                />
                <Input
                  value={draft.targetPort}
                  onChange={(e) => setDraft((d) => ({ ...d, targetPort: e.target.value }))}
                  placeholder="Port"
                  inputMode="numeric"
                />
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={draft.tls}
                    onChange={(e) => setDraft((d) => ({ ...d, tls: e.target.checked }))}
                  />
                  HTTPS (Let&apos;s Encrypt)
                </label>
                <Button type="button" size="sm" onClick={() => void addResource()}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add
                </Button>
                <span className="text-muted-foreground">
                  http / https / h2c is how Traefik reaches the target (https upstreams skip
                  certificate verification); the checkbox is the public side.
                </span>
              </div>
            </div>
            {resError && <p className="text-xs text-red-500">{resError}</p>}
            <Button type="button" variant="ghost" size="sm" disabled={refreshing} onClick={() => void refreshStatus()}>
              <RefreshCw className={`mr-1 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing…" : "Refresh status"}
            </Button>
            {lastPolled && (
              <span className="ml-2 align-middle text-xs text-muted-foreground">
                Traefik last fetched config: {new Date(lastPolled).toLocaleString()}
              </span>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4" /> System Health
            {health &&
              (healthRed ? (
                <span className="ml-auto rounded-full border border-red-500/50 bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-600">
                  Attention needed
                </span>
              ) : healthAmber ? (
                <span className="ml-auto rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600">
                  OK, with warnings
                </span>
              ) : (
                <span className="ml-auto rounded-full border border-green-600/50 bg-green-600/10 px-2 py-0.5 text-xs font-medium text-green-600">
                  {health.split.active ? "All good — separation live" : "All good"}
                </span>
              ))}
          </CardTitle>
          <CardDescription>
            Live container status (published by the traefik-ops sidecar — the portal itself holds
            no docker socket) and guest/admin separation checks. Refreshes every 30 seconds.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {healthErr && <p className="text-xs text-red-500">{healthErr}</p>}
          {!health && !healthErr && <p className="text-xs text-muted-foreground">Checking…</p>}
          {health && (
            <>
              {health.docker.available ? (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {[...health.docker.containers]
                    .sort((a, b) => containerRank(a.name) - containerRank(b.name))
                    .map((c) => (
                      <div key={c.name} className="flex items-start gap-1.5 rounded-md border p-2 text-xs">
                        {c.ok && !c.warn && <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />}
                        {c.warn && <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />}
                        {!c.ok && <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />}
                        <span className="min-w-0">
                          <span className="font-medium">{containerLabel(c.name, health.split.active)}</span>{" "}
                          <code className="text-muted-foreground">{imageTag(c.image)}</code>
                          <span className="block truncate text-muted-foreground" title={c.status}>
                            {c.status}
                          </span>
                        </span>
                      </div>
                    ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Container status unavailable — {health.docker.reason}
                </p>
              )}
              <CheckRows items={health.checks} />
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" disabled={healthBusy} onClick={() => void loadHealth()}>
                  <RefreshCw className={`mr-1 h-3.5 w-3.5 ${healthBusy ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
                <span className="text-xs text-muted-foreground">
                  Checked {new Date(health.generatedAt).toLocaleTimeString()}
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>

      <Dialog open={restartOpen} onOpenChange={(o) => !o && setRestartOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restart Traefik</DialogTitle>
            <DialogDescription>
              Confirm with your account password{restartNeedCode ? " and one-time code" : ""} —
              the proxy drops for a moment while it restarts.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="password"
              autoFocus
              value={restartPw}
              onChange={(e) => setRestartPw(e.target.value)}
              placeholder="Account password"
            />
            {restartNeedCode && (
              <Input
                inputMode="numeric"
                value={restartCode}
                onChange={(e) => setRestartCode(e.target.value)}
                placeholder="One-time code"
              />
            )}
            {restartMsg && <p className="text-xs text-red-500">{restartMsg}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRestartOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={restartBusy || !restartPw} onClick={() => void runRestart()}>
              {restartBusy ? "Restarting…" : "Restart"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SaveToast toast={toast} onClose={clear} />
    </form>
  );
}
