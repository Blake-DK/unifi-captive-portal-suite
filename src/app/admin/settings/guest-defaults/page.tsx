"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAdminSettings } from "@/lib/useAdminSettings";
import { SaveToast, useSaveToast } from "@/components/admin/SaveToast";

export default function GuestDefaultsSettingsPage() {
  const { settings, set, save, loading, saving } = useAdminSettings();
  const { toast, show, clear } = useSaveToast();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await save();
    show(ok ? "Settings saved!" : "Failed to save settings.", ok ? "success" : "error");
  };

  if (loading) return <div>Loading…</div>;

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Guest Defaults</CardTitle>
          <CardDescription>Applied to each new guest authorisation</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Session Duration (min)</Label>
            <Input type="number" min={0} value={settings.guestDurationMin}
              onChange={(e) => set("guestDurationMin", Math.max(0, parseInt(e.target.value) || 0))}
              placeholder="0 = never expires" />
            <p className="text-xs text-muted-foreground">0 = access never expires</p>
          </div>
          <div className="space-y-1.5">
            <Label>Data Quota (MB)</Label>
            <Input type="number" min={0} value={settings.guestQuotaMB}
              onChange={(e) => set("guestQuotaMB", parseInt(e.target.value) || 0)}
              placeholder="0 = unlimited" />
          </div>
          <div className="space-y-1.5">
            <Label>Download Limit (Kbps)</Label>
            <Input type="number" min={0} value={settings.guestDownKbps}
              onChange={(e) => set("guestDownKbps", parseInt(e.target.value) || 0)}
              placeholder="0 = unlimited" />
          </div>
          <div className="space-y-1.5">
            <Label>Upload Limit (Kbps)</Label>
            <Input type="number" min={0} value={settings.guestUpKbps}
              onChange={(e) => set("guestUpKbps", parseInt(e.target.value) || 0)}
              placeholder="0 = unlimited" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Self-Service Portal</CardTitle>
          <CardDescription>Limits for guests managing their own devices at /portal/my-devices</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5 max-w-xs">
            <Label>Max Devices per Phone Number</Label>
            <Input type="number" min={1} value={settings.maxDevicesPerPhone}
              onChange={(e) => set("maxDevicesPerPhone", parseInt(e.target.value) || 5)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sponsored Access</CardTitle>
          <CardDescription>
            Require a named sponsor to approve each registration by email before access is
            granted (a valid voucher still bypasses this). Approval links work once and expire
            after an hour; the sponsor&apos;s identity lands in the audit trail.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.sponsorRequired}
              onChange={(e) => set("sponsorRequired", e.target.checked)}
            />
            Require sponsor approval for guest registrations
          </label>
          <div className="space-y-1.5">
            <Label>Sponsor list (one email per line — shown as a dropdown)</Label>
            <textarea
              value={settings.sponsorEmails}
              onChange={(e) => set("sponsorEmails", e.target.value)}
              rows={4}
              placeholder={"poc@unit.mil\nfrontdesk@unit.mil"}
              className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Allowed sponsor domains (one per line — free-text sponsor entry)</Label>
            <textarea
              value={settings.sponsorDomains}
              onChange={(e) => set("sponsorDomains", e.target.value)}
              rows={2}
              placeholder="unit.mil"
              className="min-h-[48px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Used when the sponsor list above is empty: guests type any address on one of these
              domains. With a sponsor list configured, the dropdown wins.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="space-y-1.5">
              <Label>Approved access duration (minutes)</Label>
              <Input
                type="number"
                min={15}
                className="w-32"
                value={settings.sponsorDefaultMin}
                onChange={(e) => set("sponsorDefaultMin", parseInt(e.target.value) || 1440)}
              />
            </div>
            <label className="flex items-center gap-2 pt-5 text-sm">
              <input
                type="checkbox"
                checked={settings.sponsorDurationOverride}
                onChange={(e) => set("sponsorDurationOverride", e.target.checked)}
              />
              Sponsor may choose the duration per visitor
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Requires email to be configured (Settings → Email). Sponsored registrations skip
            email verification — the sponsor&apos;s approval is the verification.
          </p>
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
