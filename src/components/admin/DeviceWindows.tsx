"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, GripHorizontal, RefreshCw, TriangleAlert, X } from "lucide-react";
import type { TopoNode } from "@/lib/topology";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DeviceTerminal } from "./DeviceTerminal";
import { PcapButton } from "./PcapButton";
import { RandomMacBadge } from "./RandomMacBadge";
import { useClientWindows } from "./ClientWindows";
import { isLocallyAdministeredMac } from "@/lib/mac";
import { TYPE_LABEL, RADIO_LABEL, agoLabel, formatUptime } from "@/lib/deviceLabels";
import type { DeviceIssue } from "@/lib/issues";

/**
 * Floating, draggable per-device windows — the device counterpart of
 * ClientWindows. Any number can be open at once (one per MAC): opened from the
 * map, the device tables, or by clicking a device in another window's path, so
 * an operator can lay a switch and its uplinks side by side. Drag by the title
 * bar, raise on click. Everything the old modal dialog showed lives here now.
 */

type WindowState = { mac: string; hint?: string; x: number; y: number; z: number };

const Ctx = createContext<{ open: (mac: string, hint?: string) => void } | null>(null);

export function useDeviceWindows() {
  const ctx = useContext(Ctx);
  return ctx ?? { open: () => {} };
}

// Window stacking stays in [BASE_Z, BASE_Z + count): raising a window
// RENUMBERS the stack instead of incrementing a counter forever — an
// unbounded counter eventually crossed the dialogs' z-50 and floated the
// windows over every modal (seen live: the packet-capture dialog opened
// underneath its own device window).
const BASE_Z = 20;

function stackOnTop(ws: WindowState[], mac: string): WindowState[] {
  const rest = ws.filter((w) => w.mac !== mac).sort((a, b) => a.z - b.z);
  const target = ws.find((w) => w.mac === mac);
  return (target ? [...rest, target] : rest).map((w, i) => ({ ...w, z: BASE_Z + i }));
}

export function DeviceWindowsProvider({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<WindowState[]>([]);
  const cascade = useRef(0);

  const raise = useCallback((mac: string) => {
    setWindows((ws) => stackOnTop(ws, mac));
  }, []);

  const open = useCallback(
    (rawMac: string, hint?: string) => {
      const mac = rawMac.toLowerCase();
      setWindows((ws) => {
        if (ws.some((w) => w.mac === mac)) return stackOnTop(ws, mac);
        cascade.current = (cascade.current + 1) % 8;
        return stackOnTop(
          [...ws, { mac, hint, x: 120 + cascade.current * 34, y: 90 + cascade.current * 34, z: 0 }],
          mac,
        );
      });
    },
    [],
  );

  const close = useCallback((mac: string) => {
    setWindows((ws) => ws.filter((w) => w.mac !== mac));
  }, []);

  const move = useCallback((mac: string, x: number, y: number) => {
    setWindows((ws) => ws.map((w) => (w.mac === mac ? { ...w, x, y } : w)));
  }, []);

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {windows.map((w) => (
        <DeviceWindow key={w.mac} win={w} onClose={close} onMove={move} onRaise={raise} />
      ))}
    </Ctx.Provider>
  );
}

type DeviceDetail = { node: TopoNode; canControl: boolean; canIgnore: boolean; issues: DeviceIssue[] };

function DeviceWindow({
  win,
  onClose,
  onMove,
  onRaise,
}: {
  win: WindowState;
  onClose: (mac: string) => void;
  onMove: (mac: string, x: number, y: number) => void;
  onRaise: (mac: string) => void;
}) {
  const [detail, setDetail] = useState<DeviceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/devices/${encodeURIComponent(win.mac)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setDetail(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load device");
    } finally {
      setLoading(false);
    }
  }, [win.mac]);

  useEffect(() => {
    void load();
  }, [load]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { dx: e.clientX - win.x, dy: e.clientY - win.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onMove(
      win.mac,
      Math.max(0, Math.min(e.clientX - drag.current.dx, window.innerWidth - 120)),
      Math.max(0, Math.min(e.clientY - drag.current.dy, window.innerHeight - 40)),
    );
  };
  const endDrag = () => {
    drag.current = null;
  };

  const node = detail?.node ?? null;
  const title = node?.name ?? win.hint ?? win.mac;

  return (
    <div
      className="fixed w-[42rem] max-w-[calc(100vw-2rem)] rounded-lg border bg-card text-card-foreground shadow-2xl"
      style={{ left: win.x, top: win.y, zIndex: win.z }}
      onMouseDown={() => onRaise(win.mac)}
    >
      <div
        className="flex cursor-move select-none items-center gap-2 rounded-t-lg border-b bg-muted/60 px-3 py-2 touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <GripHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${node?.online ? "bg-green-500" : "bg-muted-foreground/40"}`}
          title={node?.online ? "Online" : "Offline"}
        />
        <button
          type="button"
          onClick={() => void load()}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
        <button
          type="button"
          onClick={() => onClose(win.mac)}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="max-h-[75vh] overflow-y-auto p-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {loading && !detail && <p className="text-sm text-muted-foreground">Loading…</p>}
        {detail && node && (
          <DeviceDialogBody
            key={node.mac}
            node={node}
            onClose={() => onClose(win.mac)}
            canControl={detail.canControl}
            canIgnore={detail.canIgnore}
            issues={detail.issues}
          />
        )}
      </div>
    </div>
  );
}

/** "11/07/2026, 14:32 (3h 12m ago)" — when the controller last heard from an
 * offline device. Clock skew can put last_seen in the future; show just the
 * timestamp then. */
function lastSeenLabel(epochSec: number): string {
  const when = new Date(epochSec * 1000).toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const ago = agoLabel(epochSec);
  return ago ? `${when} (${ago})` : when;
}

export function DeviceDialogBody({
  node,
  onClose,
  canControl,
  canIgnore,
  issues,
}: {
  node: TopoNode;
  onClose: () => void;
  canControl: boolean;
  canIgnore: boolean;
  issues: DeviceIssue[];
}) {
  const router = useRouter();
  const { open: openClientWindow } = useClientWindows();
  const [ignoring, setIgnoring] = useState(false);
  const [ignoreNote, setIgnoreNote] = useState("");
  const [ignoreError, setIgnoreError] = useState<string | null>(null);

  // Floating windows coexist, so a client window can open alongside this one.
  const openClient = (mac: string, hint?: string) => openClientWindow(mac, hint);

  const ignoreDevice = async (n: TopoNode) => {
    setIgnoring(true);
    setIgnoreError(null);
    try {
      const res = await fetch("/api/admin/device-ignores", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mac: n.mac, note: ignoreNote }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setIgnoreError(d.error ?? "Could not ignore the device.");
        return;
      }
      setIgnoreNote("");
      onClose();
      // Server components hold the device list. refresh() re-renders them with
      // the device gone while surfaces keep their own state (filters, zoom).
      router.refresh();
    } catch {
      setIgnoreError("Network error while ignoring the device.");
    } finally {
      setIgnoring(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold leading-tight">{node.name}</h2>
        <p className="text-sm text-muted-foreground">
          {TYPE_LABEL[node.type] ?? node.type}
          {node.model ? ` · ${node.model}` : ""} ·{" "}
          <span className={node.online ? "text-green-600 dark:text-green-400" : "text-destructive"}>
            {node.online ? "online" : node.state === 0 ? "offline" : "transitional"}
          </span>
        </p>
      </div>

      <div className="space-y-1.5 text-sm">
        <Row label="IP" value={node.ip ?? "-"} mono />
        <Row label="MAC" value={node.mac} mono />
        <Row label="Uptime" value={formatUptime(node.uptime)} />
        {!node.online && (node.lastSeen ?? 0) > 0 && <Row label="Last seen" value={lastSeenLabel(node.lastSeen!)} />}
        <Row label="Firmware" value={`${node.version ?? "-"}${node.upgradable ? " (update available)" : ""}`} />
        {node.configStale && (
          <p className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            Config out of date — hasn&apos;t picked up the latest site settings yet (SNMP included).
            Reprovision it from the controller.
          </p>
        )}
        {node.cpu !== undefined && <Row label="CPU / Mem" value={`${node.cpu}% / ${node.mem}%`} />}
        {node.temperature !== undefined && (
          <Row
            label="Temperature"
            value={`${node.temperature.toFixed(0)}°C${node.fanLevel !== undefined ? ` · fan ${node.fanLevel}` : ""}${node.overheating ? " · overheating" : ""}`}
          />
        )}
        {node.clients > 0 && <Row label="Clients" value={String(node.clients)} />}
        {node.ports !== undefined && <Row label="Ports up" value={`${node.portsUp}/${node.ports}`} />}
        {node.radios && node.radios.length > 0 && (
          <Row
            label="Radios"
            value={node.radios
              .map((r) => `${RADIO_LABEL[r.radio ?? ""] ?? r.radio} ch${r.channel} ${r.cu_total ?? 0}% ${r.num_sta ?? 0}sta`)
              .join("  ·  ")}
          />
        )}
        <DevicePath node={node} />
      </div>

      {issues.length > 0 && (
        <div className="space-y-1 border-t pt-3 text-sm">
          <p className="text-xs font-medium text-muted-foreground">Live issues</p>
          {issues.map((i, idx) => (
            <p key={idx} className="flex items-start gap-2">
              {i.severity === "error" ? (
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              ) : (
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              )}
              {i.text}
            </p>
          ))}
        </div>
      )}

      {canIgnore && !node.online && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Ignore this device while it is offline</p>
          <p className="text-xs text-muted-foreground">
            Hides it from the map, the device counts, the issues list and the offline alert — everywhere on the site. The
            ignore lifts itself as soon as the device comes back online, so returning hardware is never left unmonitored.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              value={ignoreNote}
              onChange={(e) => setIgnoreNote(e.target.value)}
              placeholder="Why? e.g. decommissioned, awaiting RMA"
              className="h-8 max-w-xs"
            />
            <Button type="button" size="sm" onClick={() => void ignoreDevice(node)} disabled={ignoring}>
              {ignoring ? "Ignoring…" : "Ignore device"}
            </Button>
          </div>
          {ignoreError && <p className="text-xs text-destructive">{ignoreError}</p>}
        </div>
      )}

      <ConnectedClients node={node} onOpenClient={openClient} />
      {(node.ports ?? 0) > 0 && <DevicePorts node={node} />}
      {canControl && <DeviceActions node={node} />}
      {canControl && <DeviceSnmpTest node={node} />}
      {canControl && <DeviceSshTools node={node} />}
    </div>
  );
}

/**
 * One-device SNMP probe — separate from SSH tools (different credentials,
 * different path) and available even when the device shows offline, since
 * that's exactly the case the fallback exists to check.
 */
function DeviceSnmpTest({ node }: { node: TopoNode }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ reachable: boolean; ip: string; error: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/devices/${encodeURIComponent(node.mac)}/snmp-test`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) setErr(data.error ?? "Test failed");
      else setResult(data);
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">SNMP fallback</p>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={run}>
          {busy ? "Testing…" : "Test SNMP"}
        </Button>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      {result && (
        <p className={`text-sm ${result.reachable ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
          {result.reachable ? "✓ Reachable" : "✕ Unreachable"} ({result.ip}){result.error ? ` — ${result.error}` : ""}
        </p>
      )}
    </div>
  );
}

type ConnectedClient = {
  mac: string;
  name: string;
  ip: string | null;
  vendor: string;
  wired: boolean;
  essid: string | null;
  rssi: number | null;
  port: number | null;
};

type PathHop = { mac: string; name: string; port: number | null; wireless: boolean };

/** The full uplink path from the gateway down to this device. Each upstream hop
 * is clickable — it opens that device's own window (raising it if already open),
 * so an operator can walk the chain to the core. */
function DevicePath({ node }: { node: TopoNode }) {
  const { open } = useDeviceWindows();
  const [path, setPath] = useState<PathHop[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setPath(null);
    setFailed(false);
    fetch(`/api/admin/devices/${encodeURIComponent(node.mac)}/path`)
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        if (Array.isArray(d.path)) setPath(d.path);
        else setFailed(true);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [node.mac]);

  if (failed || (path !== null && path.length === 0)) return null;
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">Path</span>
      <span className="text-right text-xs">
        {path === null ? (
          "…"
        ) : (
          <>
            {path.map((h, i) => (
              <span key={`${h.mac}-${i}`}>
                <button
                  type="button"
                  onClick={() => open(h.mac, h.name)}
                  title="Open this device"
                  className="hover:underline decoration-dotted underline-offset-2"
                >
                  {h.name}
                </button>
                {h.port != null ? ` port ${h.port}` : ""}
                {h.wireless ? " (mesh)" : ""}
                {" → "}
              </span>
            ))}
            <span className="font-medium">{node.name}</span>
          </>
        )}
      </span>
    </div>
  );
}

type DevicePort = {
  idx: number;
  name: string | null;
  up: boolean;
  speed: number | null;
  poeWatts: number | null;
  vlans: string;
  profile: string | null;
};

function DevicePorts({ node }: { node: TopoNode }) {
  const [open, setOpen] = useState(false);
  const [ports, setPorts] = useState<DevicePort[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setOpen(false);
    setPorts(null);
    setErr(null);
  }, [node.mac]);

  useEffect(() => {
    if (!open || ports !== null) return;
    let live = true;
    fetch(`/api/admin/devices/${encodeURIComponent(node.mac)}/ports`)
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        if (Array.isArray(d.ports)) setPorts(d.ports);
        else setErr(d.error ?? "Could not load the port table.");
      })
      .catch(() => live && setErr("Network error while loading the port table."));
    return () => {
      live = false;
    };
  }, [open, ports, node.mac]);

  return (
    <div className="space-y-2 border-t pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        Ports ({node.portsUp ?? 0}/{node.ports ?? 0} up) {open ? "▾" : "▸"}
      </button>
      {open && (
        <>
          {err && <p className="text-xs text-destructive">{err}</p>}
          {!err && ports === null && <p className="text-xs text-muted-foreground">Loading…</p>}
          {ports !== null && (
            <div className="max-h-64 overflow-y-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-left">
                  <tr>
                    <th className="p-1.5">Port</th>
                    <th className="p-1.5">Name</th>
                    <th className="p-1.5">Profile</th>
                    <th className="p-1.5">Link</th>
                    <th className="p-1.5">PoE</th>
                    <th className="p-1.5">VLANs</th>
                  </tr>
                </thead>
                <tbody>
                  {ports.map((p) => (
                    <tr key={p.idx} className="border-t">
                      <td className="p-1.5">{p.idx}</td>
                      <td className="p-1.5">{p.name ?? "-"}</td>
                      <td className="p-1.5">{p.profile ?? <span className="text-muted-foreground">-</span>}</td>
                      <td className="p-1.5">
                        {p.up ? (
                          <span className="text-green-600 dark:text-green-400">
                            ● {p.speed ? (p.speed >= 1000 ? `${p.speed / 1000} GbE` : `${p.speed} Mb`) : "up"}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">○ down</span>
                        )}
                      </td>
                      <td className="p-1.5">{p.poeWatts && p.poeWatts > 0 ? `${p.poeWatts.toFixed(1)} W` : "-"}</td>
                      <td className="p-1.5 text-muted-foreground">{p.vlans}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Who is connected to this device right now, with the MAC's manufacturer. */
function ConnectedClients({
  node,
  onOpenClient,
}: {
  node: TopoNode;
  onOpenClient: (mac: string, hint?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [clients, setClients] = useState<ConnectedClient[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [randomOnly, setRandomOnly] = useState(false);

  useEffect(() => {
    setOpen(false);
    setClients(null);
    setErr(null);
    setRandomOnly(false);
  }, [node.mac]);

  useEffect(() => {
    if (!open || clients !== null) return;
    let live = true;
    fetch(`/api/admin/devices/${encodeURIComponent(node.mac)}/clients`)
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        if (Array.isArray(d.clients)) setClients(d.clients);
        else setErr(d.error ?? "Could not load the client list.");
      })
      .catch(() => live && setErr("Network error while loading the client list."));
    return () => {
      live = false;
    };
  }, [open, clients, node.mac]);

  if (!node.online && node.clients === 0) return null;

  const randomCount = (clients ?? []).filter((c) => isLocallyAdministeredMac(c.mac)).length;
  const shown = randomOnly ? (clients ?? []).filter((c) => isLocallyAdministeredMac(c.mac)) : clients;

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Connected clients ({node.clients}) {open ? "▾" : "▸"}
        </button>
        {open && randomCount > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={randomOnly} onChange={(e) => setRandomOnly(e.target.checked)} />
            Randomised MACs only ({randomCount})
          </label>
        )}
      </div>
      {open && (
        <>
          {err && <p className="text-xs text-destructive">{err}</p>}
          {!err && clients === null && <p className="text-xs text-muted-foreground">Loading…</p>}
          {clients !== null && clients.length === 0 && (
            <p className="text-xs text-muted-foreground">No clients connected right now.</p>
          )}
          {clients !== null && clients.length > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-left">
                  <tr>
                    <th className="p-1.5">Client</th>
                    <th className="p-1.5">MAC</th>
                    <th className="p-1.5">Manufacturer</th>
                    <th className="p-1.5">IP</th>
                    <th className="p-1.5">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {(shown ?? []).map((c) => (
                    <tr key={c.mac} className="border-t">
                      <td className="p-1.5">
                        <button
                          type="button"
                          onClick={() => onOpenClient(c.mac, c.name || undefined)}
                          title="Open this client's profile"
                          className="hover:underline decoration-dotted underline-offset-2"
                        >
                          {c.name || <span className="text-muted-foreground">unknown</span>}
                        </button>
                      </td>
                      <td className="p-1.5 font-mono">
                        <button
                          type="button"
                          onClick={() => onOpenClient(c.mac, c.name || undefined)}
                          title="Open this client's profile"
                          className="hover:underline decoration-dotted underline-offset-2"
                        >
                          {c.mac}
                        </button>
                      </td>
                      <td className="p-1.5">
                        {isLocallyAdministeredMac(c.mac) ? <RandomMacBadge mac={c.mac} /> : c.vendor || "-"}
                      </td>
                      <td className="p-1.5 font-mono">{c.ip ?? "-"}</td>
                      <td className="p-1.5 text-muted-foreground">
                        {c.wired
                          ? `wired${c.port != null ? ` port ${c.port}` : ""}`
                          : `${c.essid ?? "WiFi"}${c.rssi != null ? ` ${c.rssi} dBm` : ""}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DeviceSshTools({ node }: { node: TopoNode }) {
  const [diag, setDiag] = useState<{ label: string; output: string }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cmd, setCmd] = useState("");
  const [cmdOut, setCmdOut] = useState<string | null>(null);
  const [showTerminal, setShowTerminal] = useState(false);
  const base = `/api/admin/devices/${encodeURIComponent(node.mac)}`;

  const runDiag = async () => {
    setBusy("diag");
    setErr(null);
    try {
      const res = await fetch(`${base}/diagnostics`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) setErr(data.error ?? "Failed");
      else setDiag(data.results);
    } catch {
      setErr("Network error");
    } finally {
      setBusy(null);
    }
  };

  const runCmd = async () => {
    if (!cmd.trim()) return;
    if (!confirm(`Run on ${node.name}:\n\n${cmd}\n\nThis is logged. Continue?`)) return;
    setBusy("exec");
    setErr(null);
    setCmdOut(null);
    try {
      const res = await fetch(`${base}/exec`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await res.json();
      if (!res.ok) setErr(data.error ?? "Failed");
      else setCmdOut(data.output || "(no output)");
    } catch {
      setErr("Network error");
    } finally {
      setBusy(null);
    }
  };

  if (!node.online) return null;

  return (
    <div className="space-y-3 border-t pt-3">
      <p className="text-xs font-medium text-muted-foreground">SSH tools</p>
      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={runDiag}>
          {busy === "diag" ? "Running…" : "Run diagnostics"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setShowTerminal((v) => !v)}>
          {showTerminal ? "Hide terminal" : "Open terminal"}
        </Button>
      </div>

      {diag && (
        <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border bg-muted/40 p-2">
          {diag.map((d, i) => (
            <div key={i}>
              <p className="text-xs font-semibold">{d.label}</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">{d.output}</pre>
            </div>
          ))}
        </div>
      )}

      {showTerminal && <DeviceTerminal mac={node.mac} onClose={() => setShowTerminal(false)} />}

      <details className="text-sm">
        <summary className="cursor-pointer select-none text-muted-foreground">Run a command (advanced)</summary>
        <div className="mt-2 space-y-2">
          <div className="flex gap-2">
            <Input
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              placeholder="e.g. cat /var/log/messages | tail"
              className="font-mono text-xs"
              onKeyDown={(e) => e.key === "Enter" && runCmd()}
            />
            <Button type="button" variant="outline" size="sm" disabled={busy !== null || !cmd.trim()} onClick={runCmd}>
              {busy === "exec" ? "…" : "Run"}
            </Button>
          </div>
          {cmdOut !== null && (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-2 text-[11px]">{cmdOut}</pre>
          )}
          <p className="text-[11px] text-muted-foreground">Every command is recorded in the audit log.</p>
        </div>
      </details>
    </div>
  );
}

function DeviceActions({ node }: { node: TopoNode }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [locating, setLocating] = useState(Boolean(node.locating));

  const call = async (action: string, portIdx?: number): Promise<boolean> => {
    setBusy(action + (portIdx ?? ""));
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/devices/${encodeURIComponent(node.mac)}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, portIdx }),
      });
      const data = await res.json().catch(() => ({}));
      setMsg({ ok: res.ok, text: res.ok ? data.message : data.error ?? "Failed" });
      return res.ok;
    } catch {
      setMsg({ ok: false, text: "Network error" });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const confirmCall = (action: string, label: string, portIdx?: number) => {
    if (confirm(`${label} ${node.name}? This interrupts its connectivity briefly.`)) {
      void call(action, portIdx);
    }
  };

  const toggleLocate = async () => {
    const next = !locating;
    if (await call(next ? "locate-on" : "locate-off")) setLocating(next);
  };

  const defaultIface = node.type === "usw" ? "switch0" : "br0";

  return (
    <div className="space-y-3 border-t pt-3">
      <p className="text-xs font-medium text-muted-foreground">Device controls</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => confirmCall("restart", "Restart")}>
          {busy === "restart" ? "…" : "Restart"}
        </Button>
        <Button
          type="button"
          variant={locating ? "default" : "outline"}
          size="sm"
          disabled={busy !== null}
          onClick={toggleLocate}
          title="Blink the device LED to find it physically"
        >
          {busy === "locate-on" || busy === "locate-off" ? "…" : locating ? "Locating — stop" : "Locate (blink)"}
        </Button>
        {node.online && <PcapButton mac={node.mac} name={node.name} defaultIface={defaultIface} variant="button" />}
      </div>
      {node.poePorts && node.poePorts.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Power-cycle a PoE port (resets whatever it powers):</p>
          <div className="flex flex-wrap gap-2">
            {node.poePorts.map((p) => (
              <Button
                key={p.portIdx}
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => confirmCall("power-cycle", `Power-cycle port ${p.portIdx} (${p.name ?? "port"}) of`, p.portIdx)}
                title={p.poe > 0 ? `Currently drawing ${p.poe.toFixed(1)} W` : "PoE enabled, nothing drawing"}
              >
                {busy === `power-cycle${p.portIdx}` ? "…" : `Port ${p.portIdx}`}
                {p.name && <span className="ml-1 text-xs text-muted-foreground">{p.name}</span>}
              </Button>
            ))}
          </div>
        </div>
      )}
      {msg && <p className={`text-sm ${msg.ok ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>{msg.text}</p>}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs" : ""}>{value}</span>
    </div>
  );
}
