"use client";

import { useEffect, useState } from "react";
import { Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downloadBlob } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const CUSTOM = "__custom__";

type IfaceOption = { name: string; note: string | null };

/**
 * Packet capture on a UniFi device over SSH → downloads a .pcap. Full-admin
 * only server-side. Used two ways:
 *  - per switch port (ports inventory): pass portIdx/portName; the dialog notes
 *    a client port must be mirrored to the capture interface to be visible.
 *  - per device (map dialog): omit the port; capture on the device's bridge /
 *    uplink / radio interface.
 * On open, the dialog asks the device (tcpdump -D over SSH) which ports/
 * interfaces it can capture on and offers them as a picker; if that lookup
 * fails, it falls back to a free-text interface field.
 */
export function PcapButton({
  mac,
  name,
  portIdx,
  portName,
  defaultIface = "switch0",
  variant = "inline",
}: {
  mac: string;
  name: string;
  portIdx?: number;
  portName?: string;
  defaultIface?: string;
  variant?: "inline" | "button";
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<IfaceOption[] | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [choice, setChoice] = useState<string>(CUSTOM);
  const [customIface, setCustomIface] = useState(defaultIface);
  const [filter, setFilter] = useState("");
  const [seconds, setSeconds] = useState(15);
  const [packets, setPackets] = useState(2000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const iface = choice === CUSTOM ? customIface : choice;

  // Ask the device what it can capture on, once per dialog open. Until the
  // answer arrives (or when it never does), the free-text field stands in.
  useEffect(() => {
    if (!open || options !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/devices/${encodeURIComponent(mac)}/pcap`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !Array.isArray(data?.ifaces)) {
          setOptionsError(data?.error ?? "Could not list this device's ports");
          return;
        }
        const opts = data.ifaces as IfaceOption[];
        setOptions(opts);
        // Land on the conventional default when the device has it, else the
        // first real option; the operator can always switch to "Other…".
        const preferred = opts.find((o) => o.name === defaultIface) ?? opts[0];
        if (preferred) setChoice(preferred.name);
      } catch {
        if (!cancelled) setOptionsError("Could not list this device's ports");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, options, mac, defaultIface]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/devices/${encodeURIComponent(mac)}/pcap`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ iface, filter, seconds, packets }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `Capture failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const filename =
        res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "capture.pcap";
      downloadBlob(blob, filename);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Capture failed");
    } finally {
      setBusy(false);
    }
  };

  const perPort = portIdx != null;

  return (
    <>
      {variant === "button" ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Radar className="mr-1 h-3.5 w-3.5" />
          Packet capture
        </Button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Packet capture on this switch"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Radar className="h-3.5 w-3.5" />
          pcap
        </button>
      )}

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Packet capture — {name}</DialogTitle>
            <DialogDescription>
              {perPort ? (
                <>
                  tcpdump on <span className="font-mono">{name}</span>, port {portIdx}
                  {portName ? ` (${portName})` : ""}. To see a specific client&apos;s frames the
                  switch must be mirroring that port to the capture interface; otherwise capture the
                  uplink (<span className="font-mono">switch0</span> / <span className="font-mono">br0</span>).
                </>
              ) : (
                <>
                  tcpdump on <span className="font-mono">{name}</span>. Pick the port or interface
                  to capture on — the list comes from the device itself;{" "}
                  <span className="font-mono">any</span> captures on all of them at once.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-sm font-medium">Network port / interface</span>
              {options ? (
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={choice}
                  onChange={(e) => setChoice(e.target.value)}
                >
                  {options.map((o) => (
                    <option key={o.name} value={o.name}>
                      {o.name}
                      {o.note ? ` — ${o.note}` : ""}
                    </option>
                  ))}
                  <option value={CUSTOM}>Other…</option>
                </select>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {optionsError ?? "Asking the device for its ports…"}
                </p>
              )}
              {(choice === CUSTOM || (!options && optionsError)) && (
                <Input
                  value={customIface}
                  onChange={(e) => setCustomIface(e.target.value)}
                  placeholder={defaultIface}
                />
              )}
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">
                BPF filter <span className="font-normal text-muted-foreground">(optional)</span>
              </span>
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="host 10.90.0.50 and port 443"
              />
            </label>
            <div className="flex gap-3">
              <label className="flex-1 space-y-1">
                <span className="text-sm font-medium">Seconds (≤120)</span>
                <Input
                  type="number"
                  min={1}
                  max={120}
                  value={seconds}
                  onChange={(e) => setSeconds(Number(e.target.value))}
                />
              </label>
              <label className="flex-1 space-y-1">
                <span className="text-sm font-medium">Max packets (≤20000)</span>
                <Input
                  type="number"
                  min={1}
                  max={20000}
                  value={packets}
                  onChange={(e) => setPackets(Number(e.target.value))}
                />
              </label>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button
                onClick={run}
                disabled={busy || !iface.trim() || seconds < 1 || packets < 1}
              >
                {busy ? "Capturing…" : "Capture & download"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
