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

export type BlockInfo = { reason: string; blockedBy: string; blockedAt: string | Date };

/**
 * Block/Unblock a client (UniFi cmd/stamgr block-sta), requiring a reason on
 * block. `onDone` re-fetches for pages that manage their own client-side
 * state (e.g. Alerts); server-rendered pages fall back to router.refresh().
 */
export function BlockDeviceButton({
  mac,
  blocked,
  onDone,
}: {
  mac: string;
  blocked?: BlockInfo | null;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    if (onDone) onDone();
    else startTransition(() => router.refresh());
  };

  const doBlock = async () => {
    const r = reason.trim();
    if (!r) {
      setError("A reason is required");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/devices/${encodeURIComponent(mac)}/block`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: r }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j?.error ?? "Failed");
        return;
      }
      setOpen(false);
      setReason("");
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const doUnblock = async () => {
    if (!confirm(`Unblock ${mac}?`)) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/devices/${encodeURIComponent(mac)}/block`, { method: "DELETE" });
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

  if (blocked) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          size="sm"
          variant="outline"
          onClick={doUnblock}
          disabled={busy || pending}
          title={`Blocked by ${blocked.blockedBy} — ${new Date(blocked.blockedAt).toLocaleString()} — ${blocked.reason}`}
        >
          {busy ? "Unblocking…" : "Unblock"}
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="destructive"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        disabled={busy || pending}
      >
        Block
      </Button>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Block client</DialogTitle>
            <DialogDescription className="font-mono text-xs">{mac}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-sm font-medium">Reason (required)</span>
              <Input
                value={reason}
                autoFocus
                placeholder="e.g. abuse report, unsanctioned extender…"
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && reason.trim() && doBlock()}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Disconnects the device and refuses reconnection until unblocked. Recorded with your
              name and the time.
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={doBlock} disabled={busy || !reason.trim()}>
                {busy ? "Blocking…" : "Block"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {error && !open && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
