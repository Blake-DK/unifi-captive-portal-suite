"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminSettings } from "@/lib/useAdminSettings";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

/**
 * Global retention defaults (rows without a location), the audit-log window,
 * and a manual "Run now" trigger with last-run stats.
 */
export function RetentionSettings() {
  const { settings, set, save, loading, saving } = useAdminSettings();
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await save();
    alert(ok ? "Retention settings saved!" : "Failed to save settings.");
  };

  const runNow = async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const res = await fetch("/api/admin/retention/run", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRunResult(data?.error ?? "Retention run failed");
        return;
      }
      const s = data.stats ?? {};
      setRunResult(
        `Done — ${s.anonymized ?? 0} registration(s) anonymized, ${s.purgedAuditLogs ?? 0} audit row(s) purged (scanned ${s.scannedRegistrations ?? 0}).`,
      );
    } catch {
      setRunResult("Network error");
    } finally {
      setRunning(false);
    }
  };

  if (loading) return <div>Loading…</div>;

  const stats = settings.lastRetentionStats as {
    anonymized?: number;
    purgedAuditLogs?: number;
  } | null;

  // Map the stored (mode, days) / auditDays onto the discrete presets; anything
  // that isn't a known preset surfaces as "custom" with the raw number input.
  const GUEST_PRESETS = [30, 90, 180];
  const AUDIT_PRESETS = [90, 180, 365];
  const guestPreset =
    settings.defaultRetentionMode !== "anonymize"
      ? "forever"
      : GUEST_PRESETS.includes(settings.defaultRetentionDays)
        ? String(settings.defaultRetentionDays)
        : "custom";
  const auditPreset =
    settings.auditRetentionDays === 0
      ? "forever"
      : AUDIT_PRESETS.includes(settings.auditRetentionDays)
        ? String(settings.auditRetentionDays)
        : "custom";

  const onGuestPreset = (v: string) => {
    if (v === "forever") {
      set("defaultRetentionMode", "forever");
    } else {
      set("defaultRetentionMode", "anonymize");
      if (v !== "custom") set("defaultRetentionDays", Number(v));
      else if (!settings.defaultRetentionDays) set("defaultRetentionDays", 90);
    }
  };
  const onAuditPreset = (v: string) => {
    if (v === "forever") set("auditRetentionDays", 0);
    else if (v !== "custom") set("auditRetentionDays", Number(v));
    else if (!settings.auditRetentionDays) set("auditRetentionDays", 180);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data Retention</CardTitle>
        <CardDescription>
          Each location above sets its own policy. These defaults apply to registrations without a
          location; the audit window applies to the whole audit trail. The job runs hourly.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSave} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Guest data (no location)</Label>
              <select
                className={selectClass}
                value={guestPreset}
                onChange={(e) => onGuestPreset(e.target.value)}
              >
                <option value="forever">Keep forever</option>
                <option value="30">Anonymize after 30 days</option>
                <option value="90">Anonymize after 90 days</option>
                <option value="180">Anonymize after 180 days</option>
                <option value="custom">Custom…</option>
              </select>
              {guestPreset === "custom" && (
                <Input
                  type="number"
                  min={0}
                  aria-label="Custom days after expiry"
                  value={settings.defaultRetentionDays}
                  onChange={(e) => set("defaultRetentionDays", Number(e.target.value))}
                />
              )}
              <p className="text-xs text-muted-foreground">
                Anonymizes name / phone / email / IP this many days after a device&apos;s
                access expires. The MAC is retained (see docs/GDPR.md §8).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Audit log retention</Label>
              <select
                className={selectClass}
                value={auditPreset}
                onChange={(e) => onAuditPreset(e.target.value)}
              >
                <option value="forever">Keep forever</option>
                <option value="90">90 days</option>
                <option value="180">180 days</option>
                <option value="365">365 days</option>
                <option value="custom">Custom…</option>
              </select>
              {auditPreset === "custom" && (
                <Input
                  type="number"
                  min={0}
                  aria-label="Custom audit retention days"
                  value={settings.auditRetentionDays}
                  onChange={(e) => set("auditRetentionDays", Number(e.target.value))}
                />
              )}
              <p className="text-xs text-muted-foreground">
                Prunes admin/security audit rows older than this. Applies to the whole trail.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save Retention Settings"}
            </Button>
            <Button type="button" variant="outline" onClick={runNow} disabled={running}>
              {running ? "Running…" : "Run retention now"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {settings.lastRetentionRunAt
                ? `Last run ${new Date(settings.lastRetentionRunAt).toLocaleString()}` +
                  (stats ? ` — ${stats.anonymized ?? 0} anonymized, ${stats.purgedAuditLogs ?? 0} audit rows purged` : "")
                : "Never run yet"}
            </span>
          </div>
          {runResult && <p className="text-sm text-muted-foreground">{runResult}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
