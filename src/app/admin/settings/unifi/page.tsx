"use client";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAdminSettings } from "@/lib/useAdminSettings";
import { SaveToast, useSaveToast } from "@/components/admin/SaveToast";

type TestAttempt = { url: string; status: number; body: string };
type ApiKeyProbe = {
  configured: boolean;
  ok?: boolean;
  status?: number;
  error?: string | null;
  siteCount?: number | null;
};
type BackupAccountProbe = {
  username: string;
  ok: boolean;
  status?: number;
  error?: string;
  skipped?: boolean;
};
type TestResult = {
  success: boolean;
  unsaved?: boolean;
  attempts: TestAttempt[];
  recommendation: string;
  error?: string;
  apiKey?: ApiKeyProbe;
  backupAccounts?: BackupAccountProbe[];
};

type KeyTestResult = {
  success: boolean;
  unsaved?: boolean;
  status?: number;
  error?: string;
  siteCount?: number;
  siteNames?: string[];
  capabilities?: { name: string; auth: string }[];
};

type SiteOption = { id: string; internalReference: string | null; name: string | null };

type HotspotCheck = { key: string; label: string; desired: unknown; current: unknown; ok: boolean };
type HotspotWlan = { id: string; name: string; enabled: boolean; isGuest: boolean };
type HotspotStatus = {
  portalUrl?: string;
  checks?: HotspotCheck[];
  allOk?: boolean;
  wlans?: HotspotWlan[];
  applied?: string[];
  error?: string;
};

const fmtVal = (v: unknown) => (v === null || v === undefined ? "—" : String(v));

export default function UnifiSettingsPage() {
  const { settings, set, save, loading, saving, dirty } = useAdminSettings();
  const { toast, show, clear } = useSaveToast();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testingKey, setTestingKey] = useState(false);
  const [keyResult, setKeyResult] = useState<KeyTestResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [sites, setSites] = useState<SiteOption[] | null>(null);
  const [sitesBusy, setSitesBusy] = useState(false);
  const [sitesError, setSitesError] = useState<string | null>(null);
  const [hotspot, setHotspot] = useState<HotspotStatus | null>(null);
  const [hotspotBusy, setHotspotBusy] = useState<"check" | "apply" | null>(null);
  const [selectedWlans, setSelectedWlans] = useState<string[]>([]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await save();
    show(ok ? "Settings saved!" : "Failed to save settings.", ok ? "success" : "error");
  };

  // The connection-test box verdict counts both mechanisms: a passing API key
  // with a failing username/password login is "partial" (amber), not red.
  const loginOk = testResult?.success === true;
  const keyConfigured = testResult?.apiKey?.configured === true;
  const keyOk = keyConfigured && testResult?.apiKey?.ok === true;
  const testAllOk = loginOk && (!keyConfigured || keyOk);
  const testPartial = !testAllOk && (loginOk || keyOk);

  const portalExternalUrl = `${settings.portalBaseUrl.replace(/\/$/, "") || "http://<server-ip>"}/guest/s/${settings.unifiSite || "default"}/`;

  const copyPortalUrl = () => {
    navigator.clipboard.writeText(portalExternalUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/unifi/test", { method: "POST" });
      const data = await res.json();
      // Belt & braces: an auth-gate error (or an older server) has no
      // `attempts`; rendering must never crash the page over that.
      setTestResult({
        unsaved: dirty,
        success: Boolean(data.success),
        attempts: Array.isArray(data.attempts) ? data.attempts : [],
        recommendation: data.recommendation ?? "",
        error: data.error,
        apiKey: data.apiKey,
        backupAccounts: Array.isArray(data.backupAccounts) ? data.backupAccounts : [],
      });
    } catch {
      setTestResult({ success: false, attempts: [], recommendation: "Network error — could not reach the test endpoint." });
    } finally {
      setTesting(false);
    }
  };

  const fetchSites = async () => {
    setSitesBusy(true);
    setSitesError(null);
    try {
      const res = await fetch("/api/admin/unifi/sites");
      const data = await res.json();
      if (data.error || !Array.isArray(data.sites)) {
        setSites(null);
        setSitesError(data.error || "Failed to fetch sites.");
      } else if (data.sites.length === 0) {
        setSites(null);
        setSitesError("The Integration API key sees no sites.");
      } else {
        setSites(data.sites);
      }
    } catch {
      setSites(null);
      setSitesError("Network error — could not reach the sites endpoint.");
    } finally {
      setSitesBusy(false);
    }
  };

  const testApiKey = async () => {
    setTestingKey(true);
    setKeyResult(null);
    try {
      const res = await fetch("/api/admin/unifi/test-key", { method: "POST" });
      setKeyResult({ ...(await res.json()), unsaved: dirty });
    } catch {
      setKeyResult({ success: false, error: "Network error — could not reach the test endpoint." });
    } finally {
      setTestingKey(false);
    }
  };

  const runHotspot = async (mode: "check" | "apply") => {
    setHotspotBusy(mode);
    try {
      const res = await fetch("/api/admin/unifi/hotspot", {
        method: mode === "check" ? "GET" : "POST",
        ...(mode === "apply" && {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ wlanIds: selectedWlans }),
        }),
      });
      const data: HotspotStatus = await res.json().catch(() => ({ error: "Bad response" }));
      setHotspot(data);
      if (data.wlans) {
        setSelectedWlans(data.wlans.filter((w) => w.isGuest).map((w) => w.id));
      }
    } catch {
      setHotspot({ error: "Network error — could not reach the hotspot endpoint." });
    } finally {
      setHotspotBusy(null);
    }
  };

  const toggleWlan = (id: string) =>
    setSelectedWlans((sel) => (sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]));

  if (loading) return <div>Loading…</div>;

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Portal Setup</CardTitle>
          <CardDescription>Configure UniFi to redirect guests to this portal</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>External Portal URL</Label>
            <div className="flex gap-2">
              <Input readOnly value={portalExternalUrl} className="font-mono text-xs bg-muted" />
              <Button type="button" variant="outline" onClick={copyPortalUrl}>
                {copied ? "Copied!" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Derived from the Captive Portal URL (set it in Settings → URLs). Enter this URL in
              UniFi: Settings → WiFi → [your guest SSID] → Advanced → Guest Hotspot → External Portal Server
            </p>
          </div>
          <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-semibold text-foreground">
              UniFi Configuration Steps (manual — or use the one-click Hotspot Configuration below)
            </p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>Open the UniFi Network Application and go to <strong>Settings → WiFi</strong></li>
              <li>Edit your <strong>guest SSID</strong></li>
              <li>Under <strong>Advanced</strong>, enable <strong>Guest Hotspot</strong></li>
              <li>Set the <strong>Portal</strong> type to <strong>External Portal Server</strong></li>
              <li>Paste the External Portal URL above into the URL field</li>
              <li>Save and re-apply the SSID</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>UniFi Connection</CardTitle>
          <CardDescription>Overrides the values set in the .env file</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Controller URL</Label>
            <Input value={settings.unifiUrl} onChange={(e) => set("unifiUrl", e.target.value)} placeholder="https://10.90.0.1:8443" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input value={settings.unifiUsername} onChange={(e) => set("unifiUsername", e.target.value)} placeholder="portal-api" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input type="password" value={settings.unifiPassword} onChange={(e) => set("unifiPassword", e.target.value)} placeholder="••••••••" autoComplete="new-password" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Backup accounts (lockout failover)</Label>
            <p className="text-xs text-muted-foreground">
              Optional extra local admin accounts, tried in order ONLY while the account above is
              locked out or cooling down — never rotated while it is healthy. Give each its own
              password; clear a username to disable that slot.
            </p>
            <div className="space-y-2">
              {([
                { u: "unifiUsername2", p: "unifiPassword2", set: settings.unifiPassword2Set, n: 2 },
                { u: "unifiUsername3", p: "unifiPassword3", set: settings.unifiPassword3Set, n: 3 },
                { u: "unifiUsername4", p: "unifiPassword4", set: settings.unifiPassword4Set, n: 4 },
              ] as const).map((s) => (
                <div key={s.n} className="grid gap-3 sm:grid-cols-2">
                  <Input
                    value={settings[s.u]}
                    onChange={(e) => set(s.u, e.target.value)}
                    placeholder={`backup account ${s.n} username`}
                    autoComplete="off"
                  />
                  <Input
                    type="password"
                    value={settings[s.p]}
                    onChange={(e) => set(s.p, e.target.value)}
                    placeholder={s.set ? "•••••••• (saved — blank keeps it)" : "password"}
                    autoComplete="new-password"
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Site Name</Label>
            <div className="flex gap-2">
              {sites ? (
                <select
                  value={settings.unifiSite}
                  onChange={(e) => set("unifiSite", e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {/* Keep an unlisted saved value selectable so opening the
                      dropdown can't silently change what is stored. */}
                  {!sites.some((s) => (s.internalReference ?? s.name ?? s.id) === settings.unifiSite) && (
                    <option value={settings.unifiSite}>
                      {settings.unifiSite || "(not set)"} — not in the fetched list
                    </option>
                  )}
                  {sites.map((s) => {
                    const value = s.internalReference ?? s.name ?? s.id;
                    return (
                      <option key={s.id} value={value}>
                        {s.name || value}
                        {s.internalReference && s.name !== s.internalReference ? ` (${s.internalReference})` : ""}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <Input value={settings.unifiSite} onChange={(e) => set("unifiSite", e.target.value)} placeholder="default" />
              )}
              <Button type="button" variant="outline" onClick={fetchSites} disabled={sitesBusy}>
                {sitesBusy ? "Fetching…" : "Fetch sites"}
              </Button>
            </div>
            {sitesError && <p className="text-xs text-destructive">{sitesError}</p>}
            {sites && (
              <p className="text-xs text-muted-foreground">
                Sites listed by the Integration API key; the internal site name (what UniFi calls it in URLs, e.g. &ldquo;default&rdquo;) is what gets saved. Remember to save settings.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>API Type</Label>
            <select
              value={settings.unifiApiType}
              onChange={(e) => set("unifiApiType", e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="auto">Auto-detect</option>
              <option value="classic">Classic Controller (/api/login)</option>
              <option value="network_app">Network Application (/api/auth/login)</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Use &ldquo;Network Application&rdquo; for UDM-Pro, UDM-SE, or UniFi Network App v7+.
              Use &ldquo;Classic Controller&rdquo; for older self-hosted controllers.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={settings.unifiInsecureTls}
              onChange={(e) => set("unifiInsecureTls", e.target.checked)} />
            Allow self-signed / insecure TLS certificate
          </label>
          <div className="pt-1 space-y-3">
            <Button type="button" variant="outline" onClick={testConnection} disabled={testing}>
              {testing ? "Testing…" : "Test Connection"}
            </Button>
            {testResult && (
              <div className={`max-w-xl rounded-md border p-3 text-sm space-y-2 ${testAllOk ? "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400" : testPartial ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400" : "border-destructive/50 bg-destructive/10 text-destructive"}`}>
                <p className="font-semibold">
                  {testAllOk
                    ? "Connected successfully"
                    : testPartial
                      ? loginOk
                        ? "Username/password login OK — API key failed"
                        : "API key OK — username/password login failed"
                      : "Connection failed"}
                </p>
                {testResult.unsaved && (
                  <p className="text-xs font-medium">
                    ⚠ You have unsaved changes on this page — this test used the last SAVED
                    settings. Save Settings, then test again.
                  </p>
                )}
                {testResult.error && <p>{testResult.error}</p>}
                <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
                  Username / password login
                </p>
                {testResult.attempts.map((a, i) => (
                  <div key={i} className="rounded bg-muted p-2 text-xs space-y-0.5">
                    <p className={`font-semibold ${a.status >= 200 && a.status < 300 ? "text-green-700 dark:text-green-400" : "text-destructive"}`}>
                      {a.status >= 200 && a.status < 300 ? "✓" : "✗"}{" "}
                      {a.url.includes("/api/auth/login")
                        ? "Network Application API (/api/auth/login)"
                        : "Classic API (/api/login)"}{" "}
                      — {a.status ? `HTTP ${a.status}` : "no response"}
                    </p>
                    <p className="break-all font-mono">{a.url}</p>
                    {a.body && <p className="break-all font-mono text-muted-foreground">{a.body}</p>}
                  </div>
                ))}
                {!!testResult.backupAccounts?.length && (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
                      Backup accounts
                    </p>
                    <div className="rounded bg-muted p-2 text-xs space-y-0.5">
                      {testResult.backupAccounts.map((b, i) => (
                        <p
                          key={i}
                          className={`break-all font-mono ${b.ok ? "text-green-700 dark:text-green-400" : b.skipped ? "text-muted-foreground" : "text-destructive"}`}
                        >
                          {b.ok ? "✓" : b.skipped ? "–" : "✗"} {b.username}
                          {b.status ? ` — HTTP ${b.status}` : ""}
                          {b.error ? ` — ${b.error}` : ""}
                        </p>
                      ))}
                    </div>
                  </>
                )}
                <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
                  Integration API key
                </p>
                <div className="rounded bg-muted p-2 text-xs space-y-0.5">
                  {!testResult.apiKey?.configured ? (
                    <p className="text-muted-foreground">Not configured — optional, set one below.</p>
                  ) : testResult.apiKey.ok ? (
                    <p className="font-semibold text-green-700 dark:text-green-400">
                      ✓ API key accepted — HTTP {testResult.apiKey.status}
                      {typeof testResult.apiKey.siteCount === "number"
                        ? `, ${testResult.apiKey.siteCount} site(s) visible`
                        : ""}
                    </p>
                  ) : (
                    <>
                      <p className="font-semibold text-destructive">
                        ✗ API key rejected — {testResult.apiKey.status ? `HTTP ${testResult.apiKey.status}` : "no response"}
                      </p>
                      {testResult.apiKey.error && (
                        <p className="break-all font-mono text-muted-foreground">{testResult.apiKey.error}</p>
                      )}
                    </>
                  )}
                </div>
                {testResult.recommendation && (
                  <p className="text-xs">{testResult.recommendation}</p>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Integration API Key (optional)</CardTitle>
          <CardDescription>
            Supplements — does not replace — the local account above. Requires UniFi OS 4+ /
            Network 9+. The Integration API only covers monitoring reads (sites, clients,
            devices); guest authorization, notes, throttling and configuration always use the
            local account. With a key set, those reads keep working even if the local account
            is locked or its password changes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>API Key {settings.unifiApiKeySet ? "(set — blank keeps it)" : ""}</Label>
            <Input
              type="password"
              value={settings.unifiApiKey}
              onChange={(e) => set("unifiApiKey", e.target.value)}
              placeholder={settings.unifiApiKeySet ? "••••••••" : "Create one in UniFi: Settings → Control Plane → Integrations"}
              autoComplete="new-password"
            />
          </div>
          <div className="pt-1 space-y-3">
            <Button type="button" variant="outline" onClick={testApiKey} disabled={testingKey}>
              {testingKey ? "Testing…" : "Test API Key"}
            </Button>
            {keyResult && (
              <div className={`rounded-md border p-3 text-sm space-y-2 ${keyResult.success ? "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400" : "border-destructive/50 bg-destructive/10 text-destructive"}`}>
                {keyResult.unsaved && (
                  <p className="text-xs font-medium">
                    ⚠ You have unsaved changes on this page — this test used the last SAVED
                    settings. Save Settings, then test again.
                  </p>
                )}
                <p className="font-semibold">
                  {keyResult.success
                    ? `API key works — ${keyResult.siteCount ?? 0} site(s) visible${keyResult.siteNames?.length ? `: ${keyResult.siteNames.join(", ")}` : ""}`
                    : "API key test failed"}
                </p>
                {keyResult.error && <p>{keyResult.error}</p>}
                {keyResult.capabilities && (
                  <table className="w-full text-xs">
                    <tbody>
                      {keyResult.capabilities.map((c) => (
                        <tr key={c.name} className="border-b last:border-0 border-current/20">
                          <td className="py-1 pr-2">{c.name}</td>
                          <td className="py-1 text-right font-mono">{c.auth}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hotspot Configuration</CardTitle>
          <CardDescription>
            Check what the controller&apos;s guest-portal settings should look like for this
            portal, pick which SSIDs use it, and apply everything in one click. Test the
            connection above first, and save any changed settings before applying.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => runHotspot("check")} disabled={hotspotBusy !== null}>
              {hotspotBusy === "check" ? "Checking…" : "Check Configuration"}
            </Button>
            {hotspot?.checks && (
              <Button
                type="button"
                onClick={() => {
                  if (confirm("Apply the guest hotspot configuration to the UniFi controller?")) {
                    runHotspot("apply");
                  }
                }}
                disabled={hotspotBusy !== null}
              >
                {hotspotBusy === "apply" ? "Applying…" : "Apply Hotspot Configuration"}
              </Button>
            )}
          </div>

          {hotspot?.error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {hotspot.error}
            </div>
          )}

          {hotspot?.applied && hotspot.applied.length > 0 && (
            <div className="rounded-md border border-green-500/50 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
              <p className="font-semibold">Applied:</p>
              <ul className="list-disc list-inside">
                {hotspot.applied.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          {hotspot?.applied && hotspot.applied.length === 0 && (
            <div className="rounded-md border border-green-500/50 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
              Nothing to change — everything already matched.
            </div>
          )}

          {hotspot?.checks && (
            <div className="space-y-3">
              <div className="rounded-md border">
                <table className="w-full text-sm">
                  <tbody>
                    {hotspot.checks.map((c) => (
                      <tr key={c.key} className="border-b last:border-0">
                        <td className="w-8 px-3 py-2">{c.ok ? <Check aria-label="OK" className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : <X aria-label="Needs change" className="h-4 w-4 text-red-600 dark:text-red-400" />}</td>
                        <td className="px-1 py-2">{c.label}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                          {c.ok ? fmtVal(c.current) : `${fmtVal(c.current)} → ${fmtVal(c.desired)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {hotspot.wlans && hotspot.wlans.length > 0 && (
                <div className="space-y-1.5">
                  <Label>SSIDs using the guest hotspot portal</Label>
                  <div className="rounded-md border p-3 space-y-2">
                    {hotspot.wlans.map((w) => (
                      <label
                        key={w.id}
                        className={`flex items-center gap-2 text-sm ${w.enabled ? "" : "text-muted-foreground"}`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedWlans.includes(w.id)}
                          onChange={() => toggleWlan(w.id)}
                          disabled={!w.enabled}
                        />
                        {w.name}
                        {!w.enabled && " (SSID disabled in UniFi)"}
                        {w.isGuest && <span className="text-xs text-green-700 dark:text-green-400">— currently on</span>}
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Applying enables the hotspot portal on checked SSIDs and disables it on
                    unchecked ones. Guests on those SSIDs are redirected to this portal until
                    authorized.
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>
      <SaveToast toast={toast} onClose={clear} />
    </form>
  );
}
