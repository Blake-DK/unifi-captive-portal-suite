"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAdminSettings } from "@/lib/useAdminSettings";
import { SaveToast, useSaveToast } from "@/components/admin/SaveToast";
import { SortLabel, useTableSort, type SortAccessors } from "@/components/admin/tableSort";

type SendRow = {
  id: number;
  createdAt: string;
  kind: string;
  to: string;
  provider: string;
  ok: boolean;
  error?: string | null;
};

const SEND_SORTS: SortAccessors<SendRow> = {
  when: (r) => r.createdAt,
  kind: (r) => r.kind,
  to: (r) => r.to,
  provider: (r) => r.provider,
  result: (r) => (r.ok ? "sent" : r.error || "failed"),
};

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const textareaClass =
  "min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function EmailSettingsPage() {
  const { settings, set, save, loading, saving, dirty } = useAdminSettings();
  const { toast, show, clear } = useSaveToast();
  const [testTo, setTestTo] = useState("");
  const [testState, setTestState] = useState<string | null>(null);
  const [m365Checking, setM365Checking] = useState(false);
  const [m365State, setM365State] = useState<string | null>(null);
  const [activity, setActivity] = useState<{
    recent: SendRow[];
    counts: Record<string, number>;
  } | null>(null);
  const { sorted, sort, toggle } = useTableSort(activity?.recent ?? [], SEND_SORTS);

  const loadActivity = () =>
    fetch("/api/admin/email/log")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.recent)) setActivity(d);
      })
      .catch(() => {});

  // The same site-wide refresh cadence the dashboard and alerts views honour.
  const refreshMs = Math.max(5, Number(settings.liveRefreshSec) || 15) * 1000;
  useEffect(() => {
    loadActivity();
    // Keep the Send-activity card current while the tab is open (test sends,
    // verification mails landing in the background), without polling a hidden tab.
    const timer = setInterval(() => {
      if (!document.hidden) loadActivity();
    }, refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs]);

  const checkM365 = async () => {
    setM365Checking(true);
    setM365State(dirty ? "Checking… (unsaved changes — uses the last SAVED credentials)" : "Checking…");
    try {
      const res = await fetch("/api/admin/email/m365-check", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      setM365State(
        res.ok
          ? "✓ Signed in to Microsoft 365 — now use Send test email to prove the mailbox itself."
          : data?.error ?? "Check failed",
      );
    } catch {
      setM365State("Network error");
    } finally {
      setM365Checking(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await save();
    show(ok ? "Settings saved!" : "Failed to save settings.", ok ? "success" : "error");
  };

  const sendTest = async () => {
    setTestState(dirty ? "Sending… (heads up: unsaved changes — the test uses the last saved settings)" : "Sending…");
    try {
      const res = await fetch("/api/admin/email/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: testTo }),
      });
      const data = await res.json().catch(() => ({}));
      const note = dirty ? " ⚠ This page has unsaved changes — the test used the last saved settings." : "";
      setTestState((res.ok ? `Sent to ${testTo} — check the inbox.` : data?.error ?? "Send failed") + note);
      loadActivity(); // the attempt is in EmailLog either way — show it immediately
    } catch {
      setTestState("Network error");
    }
  };

  if (loading) return <div>Loading…</div>;

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Email Verification</CardTitle>
          <CardDescription>
            Guests get a short free window at registration, receive a confirmation link by
            email, and are upgraded to the normal duration when they click it. Requires
            working SMTP settings below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.emailVerifyEnabled}
              onChange={(e) => set("emailVerifyEnabled", e.target.checked)}
            />
            Require guests to confirm an email address
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Free window at registration (minutes)</Label>
              <Input type="number" min={5} value={settings.emailVerifyInitialMin}
                onChange={(e) => set("emailVerifyInitialMin", Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>Grace window on reconnection (minutes)</Label>
              <Input type="number" min={5} value={settings.emailVerifyGraceMin}
                onChange={(e) => set("emailVerifyGraceMin", Number(e.target.value))} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            A guest who never confirms loses access when the window ends; reconnecting shows
            a &quot;check your email&quot; screen offering the grace window and a resend.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Expiry Notifications</CardTitle>
          <CardDescription>
            Email guests shortly before their access window runs out, with a one-click renew
            link to the self-service page. Requires working SMTP settings below; guests who
            registered without an email address are skipped.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.expiryNotifyEnabled}
              onChange={(e) => set("expiryNotifyEnabled", e.target.checked)}
            />
            Send an expiry warning email
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Lead time before expiry (minutes)</Label>
              <Input type="number" min={5} value={settings.expiryNotifyLeadMin}
                onChange={(e) => set("expiryNotifyLeadMin", Number(e.target.value))} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            One email per registration, sent by a background job that runs every 5 minutes.
            Devices whose access never expires are never notified; a device that re-registers
            gets a fresh warning for the new window.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email provider</CardTitle>
          <CardDescription>
            How the portal sends mail: a classic SMTP server, or Microsoft 365 via a free
            shared mailbox and Microsoft Graph (no license, no SMTP AUTH — see the setup guide
            in docs/M365-EMAIL.md).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <select
            className={selectClass + " max-w-sm"}
            value={settings.emailProvider}
            onChange={(e) => set("emailProvider", e.target.value)}
          >
            <option value="smtp">SMTP server</option>
            <option value="m365">Microsoft 365 (Graph)</option>
          </select>
          {settings.emailProvider === "m365" && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Directory (tenant) ID</Label>
                  <Input
                    value={settings.m365TenantId}
                    onChange={(e) => set("m365TenantId", e.target.value)}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    className="font-mono"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Application (client) ID</Label>
                  <Input
                    value={settings.m365ClientId}
                    onChange={(e) => set("m365ClientId", e.target.value)}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    className="font-mono"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Client secret {settings.m365ClientSecretSet ? "(set — blank keeps it)" : ""}</Label>
                  <Input
                    type="password"
                    value={settings.m365ClientSecret}
                    onChange={(e) => set("m365ClientSecret", e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Sender mailbox</Label>
                  <Input
                    value={settings.m365Sender}
                    onChange={(e) => set("m365Sender", e.target.value)}
                    placeholder="portal@yourdomain.com"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Use a <strong>shared mailbox</strong> (free, no license) and scope the app
                registration to it with an ApplicationAccessPolicy so it can never send as
                anyone else. Sends are saved to the mailbox&apos;s Sent Items.
              </p>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={() => void checkM365()} disabled={m365Checking}>
                  {m365Checking ? "Checking…" : "Check M365 connection"}
                </Button>
                {m365State && <span className="text-xs text-muted-foreground">{m365State}</span>}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {settings.emailProvider === "smtp" && (
      <Card>
        <CardHeader>
          <CardTitle>SMTP</CardTitle>
          <CardDescription>Mail server used to send the verification emails</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Host</Label>
              <Input value={settings.smtpHost} onChange={(e) => set("smtpHost", e.target.value)} placeholder="smtp.example.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Port</Label>
              <Input type="number" min={1} value={settings.smtpPort} onChange={(e) => set("smtpPort", Number(e.target.value))} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Security</Label>
              <select
                className={selectClass}
                value={settings.smtpSecurity}
                onChange={(e) => {
                  const mode = e.target.value;
                  set("smtpSecurity", mode);
                  // Follow the mode's conventional port — but never clobber a
                  // custom one the operator typed.
                  const conventional: Record<string, number> = { starttls: 587, tls: 465, none: 25 };
                  if (Object.values(conventional).includes(Number(settings.smtpPort))) {
                    set("smtpPort", conventional[mode] ?? 587);
                  }
                }}
              >
                <option value="starttls">STARTTLS (587)</option>
                <option value="tls">Implicit TLS (465)</option>
                <option value="none">None (25, lab only)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Username (blank = no auth)</Label>
              <Input value={settings.smtpUser} onChange={(e) => set("smtpUser", e.target.value)} autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label>Password {settings.smtpPasswordSet ? "(set — blank keeps it)" : ""}</Label>
              <Input type="password" value={settings.smtpPassword} onChange={(e) => set("smtpPassword", e.target.value)} autoComplete="new-password" />
            </div>
          </div>
          {((settings.smtpSecurity === "tls" && Number(settings.smtpPort) === 587) ||
            (settings.smtpSecurity === "starttls" && Number(settings.smtpPort) === 465)) && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Port/security mismatch: implicit TLS belongs on port 465 and STARTTLS on 587. The
              wrong pairing fails with an SSL &ldquo;wrong version number&rdquo; error.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>From Email</Label>
              <Input value={settings.smtpFromEmail} onChange={(e) => set("smtpFromEmail", e.target.value)} placeholder="wifi@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label>From Name</Label>
              <Input value={settings.smtpFromName} onChange={(e) => set("smtpFromName", e.target.value)} placeholder="Guest WiFi" />
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Email Design</CardTitle>
          <CardDescription>
            The verification email uses your Branding logo and primary colour; these fields
            control its text.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Input value={settings.emailVerifySubject} onChange={(e) => set("emailVerifySubject", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Heading</Label>
              <Input value={settings.emailVerifyHeading} onChange={(e) => set("emailVerifyHeading", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Body Text</Label>
            <textarea className={textareaClass} value={settings.emailVerifyBody}
              onChange={(e) => set("emailVerifyBody", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Button Label</Label>
            <Input value={settings.emailVerifyButton} onChange={(e) => set("emailVerifyButton", e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Test</CardTitle>
          <CardDescription>
            Sends the verification template to an address of your choice using the settings
            as last <strong>saved</strong> — save first, then test.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input className="max-w-xs" type="email" placeholder="you@example.com"
              value={testTo} onChange={(e) => setTestTo(e.target.value)} />
            <Button type="button" variant="outline" onClick={sendTest} disabled={!testTo}>
              Send test email
            </Button>
          </div>
          {testState && <p className="text-sm text-muted-foreground">{testState}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Send activity</CardTitle>
          <CardDescription>
            Everything the portal sent in the last 7 days, from whichever provider was active.
            With Microsoft 365, sends are also saved to the shared mailbox&apos;s Sent Items —
            and the ApplicationAccessPolicy keeps the app scoped to that one mailbox.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!activity ? (
            <p className="text-sm text-muted-foreground">No send activity recorded yet.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                {(["verify", "expiry", "alert", "test"] as const).map((k) => (
                  <span key={k} className="rounded bg-muted px-2 py-1">
                    {k}: <strong>{activity.counts[k] ?? 0}</strong>
                  </span>
                ))}
                <span
                  className={`rounded px-2 py-1 ${(activity.counts.failures ?? 0) > 0 ? "bg-destructive/10 text-destructive" : "bg-muted"}`}
                >
                  failures: <strong>{activity.counts.failures ?? 0}</strong>
                </span>
              </div>
              {activity.recent.length > 0 && (
                <div className="max-h-72 overflow-x-auto overflow-y-auto rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted text-left">
                      <tr>
                        <th className="p-2"><SortLabel label="When" k="when" sort={sort} onToggle={toggle} /></th>
                        <th className="p-2"><SortLabel label="Kind" k="kind" sort={sort} onToggle={toggle} /></th>
                        <th className="p-2"><SortLabel label="To" k="to" sort={sort} onToggle={toggle} /></th>
                        <th className="p-2"><SortLabel label="Provider" k="provider" sort={sort} onToggle={toggle} /></th>
                        <th className="p-2"><SortLabel label="Result" k="result" sort={sort} onToggle={toggle} /></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((r) => (
                        <tr key={r.id} className="border-t">
                          <td className="p-2 whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td>
                          <td className="p-2">{r.kind}</td>
                          <td className="p-2">{r.to}</td>
                          <td className="p-2">{r.provider}</td>
                          <td className={`p-2 ${r.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                            {r.ok ? "sent" : r.error || "failed"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
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
