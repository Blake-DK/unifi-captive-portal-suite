"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const DURATIONS: { label: string; min: number }[] = [
  { label: "4 hours", min: 240 },
  { label: "8 hours", min: 480 },
  { label: "24 hours", min: 1440 },
  { label: "3 days", min: 4320 },
  { label: "7 days", min: 10080 },
];

/** Approve/deny buttons on the sponsor page; approval may carry a duration
 * when the site allows sponsor overrides. */
export function SponsorDecision({
  token,
  allowDuration,
  defaultMin,
}: {
  token: string;
  allowDuration: boolean;
  defaultMin: number;
}) {
  const [minutes, setMinutes] = useState(defaultMin);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (action: "approve" | "deny") => {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch("/api/sponsor/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, action, minutes: allowDuration ? minutes : undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? "Something went wrong");
        return;
      }
      setDone(d.status);
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(null);
    }
  };

  if (done === "approved") {
    return (
      <p className="font-medium text-green-700 dark:text-green-400">
        Approved — the visitor&apos;s device is online now.
      </p>
    );
  }
  if (done === "denied") {
    return <p className="font-medium">Denied. The visitor has been informed.</p>;
  }

  return (
    <div className="space-y-3">
      {allowDuration && (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Access duration</span>
          <select
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {[...new Set([defaultMin, ...DURATIONS.map((d) => d.min)])]
              .sort((a, b) => a - b)
              .map((m) => (
                <option key={m} value={m}>
                  {DURATIONS.find((d) => d.min === m)?.label ??
                    (m % 1440 === 0 ? `${m / 1440} day${m / 1440 !== 1 ? "s" : ""}` : `${Math.round(m / 60)} hours`)}
                </option>
              ))}
          </select>
        </label>
      )}
      <div className="flex gap-2">
        <Button type="button" disabled={busy !== null} onClick={() => decide("approve")}>
          {busy === "approve" ? "Approving…" : "Approve access"}
        </Button>
        <Button type="button" variant="outline" disabled={busy !== null} onClick={() => decide("deny")}>
          {busy === "deny" ? "Denying…" : "Deny"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
