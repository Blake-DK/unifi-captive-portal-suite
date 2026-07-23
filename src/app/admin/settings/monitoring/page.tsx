"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAdminSettings } from "@/lib/useAdminSettings";
import { SaveToast, useSaveToast } from "@/components/admin/SaveToast";
import { DeviceSshCredentials } from "@/components/admin/DeviceSshCredentials";

export default function MonitoringSettingsPage() {
  const { settings, set, save, loading, saving } = useAdminSettings();
  const { toast, show, clear } = useSaveToast();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await save();
    show(ok ? "Settings saved!" : "Failed to save settings.", ok ? "success" : "error");
  };

  if (loading) return <div>Loading…</div>;

  return (
    <div className="grid gap-6">
      <form id="monitoring-settings" onSubmit={onSubmit} className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Admin live views</CardTitle>
          <CardDescription>
            How often the dashboard tiles and the Alerts list re-fetch their data in the browser —
            this refreshes the info in place, not the whole page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-[220px] space-y-1.5">
            <Label>Refresh interval (seconds)</Label>
            <Input
              type="number"
              min={3}
              max={300}
              value={settings.liveRefreshSec}
              onChange={(e) => set("liveRefreshSec", Number(e.target.value))}
            />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Network Alerts</CardTitle>
          <CardDescription>
            A background monitor polls the controller and opens/resolves alerts on device and site
            health, notifying by email and/or webhook on change (one digest per cycle — an outage of
            many devices is a single notification, not a storm). View them on the Alerts page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={settings.alertsEnabled}
              onChange={(e) => set("alertsEnabled", e.target.checked)} />
            Enable network alerting
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Poll interval (seconds)</Label>
              <Input type="number" min={30} value={settings.alertPollSec}
                onChange={(e) => set("alertPollSec", Number(e.target.value))} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Alert email (blank = no email)</Label>
              <Input type="email" value={settings.alertEmail} placeholder="noc@example.com"
                onChange={(e) => set("alertEmail", e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-3">
              <Label>Webhook URL (blank = no webhook)</Label>
              <Input value={settings.alertWebhookUrl} placeholder="https://hooks.slack.com/… or ntfy/Discord/custom"
                onChange={(e) => set("alertWebhookUrl", e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Receives a JSON POST <span className="font-mono">{"{ text, firing[], resolved[], at }"}</span> on
                every change. Email uses the SMTP settings on the Email tab. Failed sends retry with
                backoff; a delivery that still fails lands in the audit trail as a dead letter.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>
                UniFi alarm webhook secret{settings.alarmWebhookSecretSet ? " (set — blank keeps it)" : " (blank = ingress off)"}
              </Label>
              <Input type="password" value={settings.alarmWebhookSecret} autoComplete="new-password"
                placeholder={settings.alarmWebhookSecretSet ? "••••••••" : "shared secret for the controller webhook"}
                onChange={(e) => set("alarmWebhookSecret", e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Point the controller's webhook at{" "}
                <span className="font-mono">/api/webhooks/unifi-alarm</span> on this portal with{" "}
                <span className="font-mono">Authorization: Bearer &lt;secret&gt;</span> (or{" "}
                <span className="font-mono">?secret=</span>). An alarm push triggers an immediate
                alert cycle instead of waiting for the next poll; alerts must be enabled above.
              </p>
            </div>
          </div>
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="mb-2 font-medium">Alert on:</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings.alertOfflineEnabled}
                  onChange={(e) => set("alertOfflineEnabled", e.target.checked)} />
                Device offline / unhealthy
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings.alertSubsystemEnabled}
                  onChange={(e) => set("alertSubsystemEnabled", e.target.checked)} />
                Site subsystem degraded (WAN/LAN/WiFi/Internet; on dual-WAN also each WAN link)
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings.alertFirmwareEnabled}
                  onChange={(e) => set("alertFirmwareEnabled", e.target.checked)} />
                Firmware update available
              </label>
              <div className="flex items-center gap-2">
                <span>CPU ≥</span>
                <Input type="number" min={0} max={100} className="h-8 w-20"
                  value={settings.alertCpuPct} onChange={(e) => set("alertCpuPct", Number(e.target.value))} />
                <span className="text-xs text-muted-foreground">% (0 = off)</span>
              </div>
              <div className="flex items-center gap-2">
                <span>Memory ≥</span>
                <Input type="number" min={0} max={100} className="h-8 w-20"
                  value={settings.alertMemPct} onChange={(e) => set("alertMemPct", Number(e.target.value))} />
                <span className="text-xs text-muted-foreground">% (0 = off)</span>
              </div>
              <div className="flex items-center gap-2">
                <span>Switch-port link ≥</span>
                <Input type="number" min={0} max={100} className="h-8 w-20"
                  value={settings.alertSaturationPct} onChange={(e) => set("alertSaturationPct", Number(e.target.value))} />
                <span className="text-xs text-muted-foreground">% saturation (0 = off)</span>
              </div>
              <div className="flex items-center gap-2">
                <span>Port error/discard ≥</span>
                <Input type="number" min={0} max={100} className="h-8 w-20"
                  value={settings.alertPortErrPct} onChange={(e) => set("alertPortErrPct", Number(e.target.value))} />
                <span className="text-xs text-muted-foreground">% of traffic (0 = off)</span>
              </div>
              <div className="flex items-center gap-2">
                <span>Failed admin logins ≥</span>
                <Input type="number" min={0} className="h-8 w-20"
                  value={settings.alertFailedLoginCount} onChange={(e) => set("alertFailedLoginCount", Number(e.target.value))} />
                <span>within</span>
                <Input type="number" min={1} max={1440} className="h-8 w-20"
                  value={settings.alertFailedLoginWindowMin} onChange={(e) => set("alertFailedLoginWindowMin", Number(e.target.value))} />
                <span className="text-xs text-muted-foreground">min, per source IP (0 = off)</span>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={settings.alertControllerDownEnabled}
                  onChange={(e) => set("alertControllerDownEnabled", e.target.checked)} />
                <span>Controller unreachable for</span>
                <Input type="number" min={1} max={20} className="h-8 w-16"
                  value={settings.alertControllerDownCycles}
                  onChange={(e) => set("alertControllerDownCycles", Number(e.target.value))} />
                <span className="text-xs text-muted-foreground">consecutive poll cycles</span>
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings.alertRogueExtenderEnabled}
                  onChange={(e) => set("alertRogueExtenderEnabled", e.target.checked)} />
                Suspected consumer WiFi extender/mesh node
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings.alertFirstSeenEnabled}
                  onChange={(e) => set("alertFirstSeenEnabled", e.target.checked)} />
                New (never-before-seen) device joins the network
              </label>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Heuristic hostname/vendor match — off by default, and only high-confidence matches
              (hostname/model number) alert. Lower-confidence (OUI-only) matches only show as a
              badge on the Clients page, never here.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              The controller watchdog is the one rule that fires when the monitor itself cannot
              reach the controller. Every other rule goes quiet then, but email/webhook delivery
              does not depend on the controller. Manual &quot;Check now&quot; runs count toward the
              cycle streak; the first successful poll resolves the alert.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SNMP fallback</CardTitle>
          <CardDescription>
            While the controller itself is unreachable (the watchdog above), every other alert
            rule goes blind. This polls your adopted devices directly over SNMPv3 (authPriv only —
            no v1/v2c community-string support) so device reachability stays visible during the
            outage. The device list is cached from the last healthy poll, so it needs alerting and
            this feature both enabled for a while before it has anything to fall back on. Requires
            SNMPv3 enabled on the controller (Settings → System → SNMP).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={settings.snmpEnabled}
              onChange={(e) => set("snmpEnabled", e.target.checked)} />
            Enable SNMP fallback polling
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>SNMPv3 username</Label>
              <Input value={settings.snmpUser} onChange={(e) => set("snmpUser", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>UDP port</Label>
              <Input type="number" min={1} max={65535} value={settings.snmpPort}
                onChange={(e) => set("snmpPort", Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>Auth protocol</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={settings.snmpAuthProtocol}
                onChange={(e) => set("snmpAuthProtocol", e.target.value)}
              >
                <option value="sha">SHA-1</option>
                <option value="sha224">SHA-224</option>
                <option value="sha256">SHA-256</option>
                <option value="sha384">SHA-384</option>
                <option value="sha512">SHA-512</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>
                Auth key{settings.snmpAuthKeySet ? " (set — blank keeps it)" : ""}
              </Label>
              <Input type="password" value={settings.snmpAuthKey} autoComplete="new-password"
                placeholder={settings.snmpAuthKeySet ? "••••••••" : ""}
                onChange={(e) => set("snmpAuthKey", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Privacy protocol</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={settings.snmpPrivProtocol}
                onChange={(e) => set("snmpPrivProtocol", e.target.value)}
              >
                <option value="aes">AES-128</option>
                <option value="aes256b">AES-256 (Blumenthal)</option>
                <option value="aes256r">AES-256 (Reeder)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>
                Privacy key{settings.snmpPrivKeySet ? " (set — blank keeps it)" : ""}
              </Label>
              <Input type="password" value={settings.snmpPrivKey} autoComplete="new-password"
                placeholder={settings.snmpPrivKeySet ? "••••••••" : ""}
                onChange={(e) => set("snmpPrivKey", e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Most UniFi controllers show only a username and a single password on their SNMP page
            (no separate auth/privacy fields) — that&apos;s SHA-1 auth + AES-128 privacy under the
            hood, the defaults above. Enter that one password into <em>both</em> key fields here;
            only change the protocol dropdowns if your controller explicitly offers a choice. Keys
            are stored encrypted and never sent back to the browser. Save first, then test.
          </p>
          <p className="text-xs text-muted-foreground">
            Only devices with a private/LAN IP are polled — a gateway&apos;s reported address is
            often its WAN (public) IP, unreachable via SNMP from the LAN side regardless of
            credentials, so gateways are commonly excluded from the fallback while APs and
            switches on private addresses are covered.
          </p>
          <SnmpTestNow />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Duplicate-IP false positives</CardTitle>
          <CardDescription>
            MAC randomisation makes UniFi fire duplicate-IP warnings for two randomised MACs
            that merely held the same IP at different times. This gate re-checks each alarm
            (cheapest first) and only opens a <span className="font-mono">duplicate_ip</span> alert
            for a genuine live conflict. Everything gated is logged on the Alerts page — nothing
            is silently dropped. Requires network alerting (above) to be enabled.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={settings.dupIpEnabled}
              onChange={(e) => set("dupIpEnabled", e.target.checked)} />
            Gate duplicate-IP alarms
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={settings.dupIpDryRun}
              onChange={(e) => set("dupIpDryRun", e.target.checked)} />
            Dry run — classify and log only, never open alerts
          </label>
          <p className="text-xs text-muted-foreground">
            Leave dry run on for the first days: alarm payloads vary by controller firmware, so
            verify on the Alerts page that classifications look right before letting alerts fire.
          </p>
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="mb-2 font-medium">Confidence checks (cheapest first; the first decisive one wins):</p>
            <div className="grid gap-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings.dupIpCheckMacRandom}
                  onChange={(e) => set("dupIpCheckMacRandom", e.target.checked)} />
                Both MACs randomised (locally administered) → suppress
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings.dupIpCheckSessions}
                  onChange={(e) => set("dupIpCheckSessions", e.target.checked)} />
                Client sessions never overlap → suppress
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings.dupIpCheckDhcp}
                  onChange={(e) => set("dupIpCheckDhcp", e.target.checked)} />
                At most one connected client holds the IP → suppress (two+ → genuine)
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={settings.dupIpCheckArping}
                  onChange={(e) => set("dupIpCheckArping", e.target.checked)} />
                Undecided: verify on-wire via arping over device SSH (authoritative)
              </label>
            </div>
          </div>
          {settings.dupIpCheckArping && (
            <div className="space-y-1.5">
              <Label>Arping device per VLAN</Label>
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={settings.dupIpArpingMap}
                onChange={(e) => set("dupIpArpingMap", e.target.value)}
                placeholder={"420=aa:bb:cc:dd:ee:ff\n*=11:22:33:44:55:66"}
              />
              <p className="text-xs text-muted-foreground">
                One <span className="font-mono">vlan=device MAC</span> per line
                (<span className="font-mono">*</span> = any VLAN). Pick a device with an interface
                on that VLAN — usually the gateway. Needs the Device SSH credentials below; probes
                are bounded (<span className="font-mono">arping -c 3 -w 2</span>), rate-limited per
                IP, and capped per cycle. An unreachable probe never suppresses — the alert opens
                as unverified instead.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Update check</CardTitle>
          <CardDescription>
            Compares the running build against the newest release on GitHub, so the admin sidebar
            (and the public <span className="font-mono">/api/version</span> endpoint — checkable
            from anywhere the portal is reachable) can say whether an update is available. Needs a
            GitHub access token with <strong>read-only repository</strong> access (GitHub →
            Settings → Developer settings → Personal access tokens) if the repository is private.
            The token is stored encrypted and never sent to the browser. Alternatively set
            <span className="font-mono"> UPDATE_CHECK_TOKEN</span> in <span className="font-mono">.env</span> on
            the host — its presence enables the check with no UI step; a token saved here wins.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={settings.updateCheckEnabled}
              onChange={(e) => set("updateCheckEnabled", e.target.checked)} />
            Enable the update check
          </label>
          <div className="max-w-md space-y-1.5">
            <Label>
              GitHub token{" "}
              {settings.updateCheckTokenSet
                ? "(set — blank keeps it)"
                : "(optional — CI images ship a built-in read-only token)"}
            </Label>
            <Input
              type="password"
              value={settings.updateCheckToken}
              onChange={(e) => set("updateCheckToken", e.target.value)}
              placeholder={settings.updateCheckTokenSet ? "••••••••" : "read-only repository scope"}
              autoComplete="new-password"
            />
          </div>
          <div className="max-w-md space-y-1.5">
            <Label>Release line to follow</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={settings.updateCheckChannel}
              onChange={(e) => set("updateCheckChannel", e.target.value)}
            >
              <option value="stable">Stable — releases from main (v*)</option>
              <option value="develop">Develop — dev-v* tags (hosts on the :develop image)</option>
              <option value="nightly">Nightly — branch head by commit (hosts on the :nightly image)</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Pick the line this host actually runs, or the badge will compare apples to oranges.
            </p>
          </div>
          <UpdateCheckNow />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scheduled summary report</CardTitle>
          <CardDescription>
            One email per period: WiFi usage and peak clients, top talkers by client and
            application (needs DPI), average WAN latency, current PoE draw, guest and alert
            counts. Daily covers yesterday; weekly goes out Mondays; monthly on the 1st —
            each on the first cycle after 06:00 UTC.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.reportEnabled}
              onChange={(e) => set("reportEnabled", e.target.checked)}
            />
            Send the summary report
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={settings.reportFrequency}
              onChange={(e) => set("reportFrequency", e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly (Mondays)</option>
              <option value="monthly">Monthly (the 1st)</option>
            </select>
            <Input
              className="h-9 max-w-xs"
              placeholder="recipient (blank = the alert email)"
              value={settings.reportEmail}
              onChange={(e) => set("reportEmail", e.target.value)}
            />
            <SendReportNow />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Controller config history</CardTitle>
          <CardDescription>
            Hourly poll of the controller&apos;s config collections; a new version is stored only
            when something changed, with an email to the alert address and a per-collection diff
            on the Config history page. Secrets are fingerprinted before storage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.configWatchEnabled}
              onChange={(e) => set("configWatchEnabled", e.target.checked)}
            />
            Watch the controller configuration for changes
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit syslog forwarding (SIEM)</CardTitle>
          <CardDescription>
            Every audit event — guest registrations, logins, admin actions, denials — is
            forwarded as one RFC 5424 UDP line with a JSON payload. Best-effort: the audit
            trail in the database stays the record of truth.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.syslogEnabled}
              onChange={(e) => set("syslogEnabled", e.target.checked)}
            />
            Forward audit events
          </label>
          <Input
            className="h-9 max-w-xs"
            placeholder="collector host or IP"
            value={settings.syslogHost}
            onChange={(e) => set("syslogHost", e.target.value)}
          />
          <Input
            type="number"
            min={1}
            max={65535}
            className="h-9 w-24"
            value={settings.syslogPort}
            onChange={(e) => set("syslogPort", Number(e.target.value) || 514)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Metric history</CardTitle>
          <CardDescription>
            A background sampler records WAN throughput, client counts, and per-device CPU/memory
            over time so the <strong>Metrics</strong> page can chart trends and assurance history.
            Samples are pruned after the retention window. On a large fleet keep the interval coarse.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={settings.metricsEnabled}
              onChange={(e) => set("metricsEnabled", e.target.checked)} />
            Record metric history
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Sample interval (seconds)</Label>
              <Input type="number" min={60} value={settings.metricSampleSec}
                onChange={(e) => set("metricSampleSec", Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>Retention (days)</Label>
              <Input type="number" min={1} value={settings.metricRetentionDays}
                onChange={(e) => set("metricRetentionDays", Number(e.target.value))} />
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={settings.metricPerDevice}
                onChange={(e) => set("metricPerDevice", e.target.checked)} />
              Also sample per-device CPU/memory
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Per-device sampling adds one row per online device each cycle. At 300+ devices and a
            5-minute interval that&apos;s ~90k rows/day — the retention window bounds total volume.
          </p>
        </CardContent>
      </Card>

      </form>

      <Card>
        <CardHeader>
          <CardTitle>Device SSH (debugging tools)</CardTitle>
          <CardDescription>
            Credentials the controller pushes to your UniFi devices (Site → Settings → Advanced →
            Device SSH Authentication). Enables the Network Map&apos;s diagnostics, command box, and
            interactive terminal. The portal must reach devices on the LAN. Add more than one and the
            tools try each in order until a device accepts one. All three tools are full-admin only
            and every use is audited.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeviceSshCredentials />
        </CardContent>
      </Card>

      {/* The SSH card manages its own persistence; this submit belongs to the
          settings form above but sits last so the save action is always at the
          bottom of the page. */}
      <div className="flex justify-end">
        <Button type="submit" form="monitoring-settings" disabled={saving}>
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>
      <SaveToast toast={toast} onClose={clear} />
    </div>
  );
}

/** "Check now" button + result line for the update check (save the token first). */
function SendReportNow() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/report/send", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setResult(res.ok ? `Sent to ${d.to} (period ${d.period}).` : d.error ?? "Send failed");
    } catch {
      setResult("Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={run} disabled={busy}>
        {busy ? "Sending…" : "Send now"}
      </Button>
      {result && <span className="text-xs text-muted-foreground">{result}</span>}
    </span>
  );
}

/** "Test SNMP now" — probes a small live sample (gateway/AP/switch) and lists per-target results. */
function SnmpTestNow() {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ name: string; ip: string; reachable: boolean; error: string | null }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    setResults(null);
    try {
      const res = await fetch("/api/admin/snmp-test", { method: "POST" });
      const d = await res.json();
      if (!res.ok) setErr(d.error ?? "Test failed");
      else setResults(d.results);
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" size="sm" onClick={run} disabled={busy}>
        {busy ? "Testing…" : "Test SNMP now"}
      </Button>
      {err && <p className="text-sm text-destructive">{err}</p>}
      {results && (
        <ul className="space-y-1 text-sm">
          {results.map((r) => (
            <li key={r.ip} className={r.reachable ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>
              {r.reachable ? "✓" : "✕"} {r.name} ({r.ip}){r.error ? ` — ${r.error}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UpdateCheckNow() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [behind, setBehind] = useState(false);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/version-check", { method: "POST" });
      const d = await res.json();
      if (!d.enabled) setResult("Update check is disabled — enable it above and save first.");
      else if (d.error) setResult(`Check failed: ${d.error}`);
      else if (d.latest) {
        setBehind(d.upToDate === false);
        // Nightly "versions" are commit SHAs — no v prefix, compare by build.
        const runningLabel =
          d.channel === "nightly" ? `nightly ${String(d.running.commit).slice(0, 7)}` : `v${d.running.version}`;
        const base =
          d.upToDate === false
            ? `Update available: ${d.channel === "nightly" ? "" : "v"}${d.latest.version} (running ${runningLabel}) — run ./update.sh on the host.`
            : d.channel === "nightly"
              ? `Up to date — this nightly build (${String(d.running.commit).slice(0, 7)}) is the branch head.`
              : `Up to date — v${d.running.version} is the latest ${d.channel === "develop" ? "develop tag" : "release"}.`;
        setResult(d.channelNote ? `${base} — ${d.channelNote}` : base);
      } else setResult("No release information yet.");
    } catch {
      setResult("Network error — could not reach the check endpoint.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" onClick={run} disabled={busy}>
        {busy ? "Checking…" : "Check now"}
      </Button>
      {result && (
        <p className={`text-sm ${behind ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{result}</p>
      )}
    </div>
  );
}
