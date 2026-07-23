"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ThrottleInfo = {
  downKbps: number;
  upKbps: number;
  throttledBy: string;
  throttledAt: string | Date;
};

/**
 * Rate-limit a client (UniFi user group) as a gentler alternative to a hard
 * block. A dialog collects down/up Kbps; un-throttle returns it to Default.
 * Full-admin only server-side. `onDone` re-fetches for pages managing their own
 * client-side state; otherwise falls back to router.refresh().
 */
export function ThrottleButton({
  mac,
  throttled,
  onDone,
}: {
  mac: string;
  throttled?: ThrottleInfo | null;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [down, setDown] = useState(5000);
  const [up, setUp] = useState(2000);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    if (onDone) onDone();
    else startTransition(() => router.refresh());
  };

  const doThrottle = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/devices/${encodeURIComponent(mac)}/throttle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ downKbps: down, upKbps: up }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j?.error ?? "Failed");
        return;
      }
      setOpen(false);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const doUnthrottle = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/devices/${encodeURIComponent(mac)}/throttle`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j?.error ?? "Failed");
        return;
      }
      refresh();
    } finally {
      setBusy(false);
    }
  };

  if (throttled) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          size="sm"
          variant="outline"
          onClick={doUnthrottle}
          disabled={busy || pending}
          title={`Throttled to ${throttled.downKbps}/${throttled.upKbps} Kbps by ${throttled.throttledBy} — ${new Date(throttled.throttledAt).toLocaleString()}`}
        >
          {busy ? "Restoring…" : "Un-throttle"}
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={busy || pending}>
          Throttle
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Throttle client</DialogTitle>
            <DialogDescription className="font-mono text-xs">{mac}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-3">
              <label className="flex-1 space-y-1">
                <span className="text-sm font-medium">Download (Kbps)</span>
                <Input
                  type="number"
                  min={64}
                  value={down}
                  onChange={(e) => setDown(Number(e.target.value))}
                />
              </label>
              <label className="flex-1 space-y-1">
                <span className="text-sm font-medium">Upload (Kbps)</span>
                <Input
                  type="number"
                  min={64}
                  value={up}
                  onChange={(e) => setUp(Number(e.target.value))}
                />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Applies a UniFi user-group rate limit (e.g. 5000 Kbps ≈ 5 Mbps). Un-throttle returns
              the client to the Default group.
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={doThrottle} disabled={busy || down < 64 || up < 64}>
                {busy ? "Throttling…" : "Apply throttle"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
