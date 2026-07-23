"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { GripHorizontal, RefreshCw, X } from "lucide-react";
import { formatBytes } from "@/lib/utils";
import { SortLabel, useTableSort, type SortAccessors } from "@/components/admin/tableSort";
import { RandomMacBadge } from "@/components/admin/RandomMacBadge";

/**
 * Floating, draggable client-detail windows. Any number can be open at once
 * (one per MAC), they cascade on open, drag by the title bar, and raise on
 * click — so an operator can lay several clients side by side while working
 * an incident. Opened from anywhere via useClientWindows()/ClientLink.
 */

type WindowState = { mac: string; hint?: string; x: number; y: number; z: number };

const Ctx = createContext<{ open: (mac: string, hint?: string) => void } | null>(null);

export function useClientWindows() {
  const ctx = useContext(Ctx);
  return ctx ?? { open: () => {} };
}

/** Clickable client name/MAC — opens (or raises) that client's detail window. */
export function ClientLink({
  mac,
  hint,
  children,
  className,
}: {
  mac: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  const { open } = useClientWindows();
  // A <span>, not a <button>, so the MAC/hostname text stays selectable and
  // copyable (browsers force user-select:none inside buttons). A real
  // drag-select doesn't fire click, so opening the window and copying coexist.
  const launch = () => open(mac, hint === "-" ? undefined : hint);
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={launch}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          launch();
        }
      }}
      title="Open client details"
      className={
        className ??
        "cursor-pointer hover:underline decoration-dotted underline-offset-2"
      }
    >
      {children}
    </span>
  );
}

// Window stacking stays in [BASE_Z, BASE_Z + count): raising renumbers the
// stack instead of incrementing a counter forever — an unbounded counter
// eventually crossed the dialogs' z-50 and floated the windows over every
// modal. Same scheme as DeviceWindows; keep the two in sync.
const BASE_Z = 10;

function stackOnTop(ws: WindowState[], mac: string): WindowState[] {
  const rest = ws.filter((w) => w.mac !== mac).sort((a, b) => a.z - b.z);
  const target = ws.find((w) => w.mac === mac);
  return (target ? [...rest, target] : rest).map((w, i) => ({ ...w, z: BASE_Z + i }));
}

export function ClientWindowsProvider({ children }: { children: ReactNode }) {
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
          [
            ...ws,
            { mac, hint, x: 80 + cascade.current * 32, y: 80 + cascade.current * 32, z: 0 },
          ],
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
        <ClientWindow key={w.mac} win={w} onClose={close} onMove={move} onRaise={raise} />
      ))}
    </Ctx.Provider>
  );
}

type Detail = {
  mac: string;
  controllerError: string | null;
  live: {
    hostname: string | null;
    ip: string | null;
    wired: boolean;
    essid: string | null;
    rssi: number | null;
    vlan: number | null;
    network: string | null;
    uplink: string | null;
    rxBytes: number;
    txBytes: number;
  } | null;
  extender: { confidence: "high" | "low"; reason: string; vendor: string | null } | null;
  blocked: { reason: string; blockedBy: string; blockedAt: string } | null;
  registrations: {
    id: number;
    name: string;
    phone: string;
    email: string | null;
    location: string | null;
    building: string | null;
    room: string | null;
    ssid: string | null;
    label: string | null;
    authorizedAt: string;
    durationMin: number;
    revokedAt: string | null;
    lastSeenAt: string | null;
    anonymized: boolean;
  }[];
  sessions: {
    start: number | null;
    durationSec: number | null;
    ap: string | null;
    ip: string | null;
    rxBytes: number;
    txBytes: number;
  }[];
};

const SESSION_SORTS: SortAccessors<Detail["sessions"][number]> = {
  start: (s) => s.start,
  length: (s) => s.durationSec,
  via: (s) => s.ap ?? (s.ip ? "wired" : ""),
  traffic: (s) => s.rxBytes + s.txBytes,
};

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h >= 48 ? `${Math.round(h / 24)}d` : `${h}h${m ? ` ${m}m` : ""}`;
}

function ClientWindow({
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
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const sessions = useTableSort(detail?.sessions ?? [], SESSION_SORTS);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/clients/${encodeURIComponent(win.mac)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setDetail(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load client");
    } finally {
      setLoading(false);
    }
  }, [win.mac]);

  useEffect(() => {
    void load();
  }, [load]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // The refresh and close buttons live inside the drag handle. Capturing
    // their pointer would retarget the pointerup (and the click) to the bar,
    // so the buttons would never fire — press on a button means no drag.
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
  const onPointerUp = () => {
    drag.current = null;
  };
  // pointercancel / lostpointercapture also end a drag — without this a
  // canceled drag (pen leaves range, browser interrupt) leaves drag.current set
  // and the window sticks to the cursor on the next hover with no button held.
  const endDrag = () => {
    drag.current = null;
  };

  const title = detail?.live?.hostname ?? win.hint ?? win.mac;

  return (
    <div
      className="fixed w-[28rem] max-w-[calc(100vw-2rem)] rounded-lg border bg-card text-card-foreground shadow-2xl"
      style={{ left: win.x, top: win.y, zIndex: win.z }}
      onMouseDown={() => onRaise(win.mac)}
    >
      <div
        className="flex cursor-move select-none items-center gap-2 rounded-t-lg border-b bg-muted/60 px-3 py-2 touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <GripHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${detail?.live ? "bg-green-500" : "bg-muted-foreground/40"}`}
          title={detail?.live ? "Online" : "Offline / not connected"}
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

      <div className="max-h-[65vh] space-y-3 overflow-y-auto p-3 text-sm">
        <p className="font-mono text-xs text-muted-foreground">
          {win.mac}
          <RandomMacBadge mac={win.mac} className="ml-1.5" />
        </p>

        {error && <p className="text-destructive">{error}</p>}
        {loading && !detail && <p className="text-muted-foreground">Loading…</p>}

        {detail && (
          <>
            {(detail.extender || detail.blocked) && (
              <div className="flex flex-wrap gap-1.5">
                {detail.extender && (
                  <span
                    title={detail.extender.reason}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      detail.extender.confidence === "high"
                        ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                    }`}
                  >
                    {detail.extender.confidence === "high" ? "Suspected" : "Possible"} extender
                    {detail.extender.vendor ? ` (${detail.extender.vendor})` : ""}
                  </span>
                )}
                {detail.blocked && (
                  <span
                    title={`${detail.blocked.reason} — by ${detail.blocked.blockedBy}`}
                    className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300"
                  >
                    Blocked
                  </span>
                )}
              </div>
            )}

            {detail.controllerError && (
              <p className="text-xs text-destructive">Controller: {detail.controllerError}</p>
            )}

            {detail.live ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">IP</dt>
                <dd className="font-mono">{detail.live.ip ?? "-"}</dd>
                <dt className="text-muted-foreground">Connection</dt>
                <dd>
                  {detail.live.wired ? "Wired" : `WiFi ${detail.live.essid ?? ""}`}
                  {detail.live.rssi != null && !detail.live.wired ? ` (${detail.live.rssi} dBm)` : ""}
                </dd>
                <dt className="text-muted-foreground">Via</dt>
                <dd>{detail.live.uplink ?? "-"}</dd>
                <dt className="text-muted-foreground">VLAN / network</dt>
                <dd>
                  {detail.live.vlan ?? "-"}
                  {detail.live.network ? ` / ${detail.live.network}` : ""}
                </dd>
                <dt className="text-muted-foreground">Traffic</dt>
                <dd>
                  ↓ {formatBytes(detail.live.rxBytes)} · ↑ {formatBytes(detail.live.txBytes)}
                </dd>
              </dl>
            ) : (
              !detail.controllerError && (
                <p className="text-xs text-muted-foreground">Not currently connected.</p>
              )
            )}

            <HealthJourney mac={win.mac} />

            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Registrations ({detail.registrations.length})
              </h4>
              {detail.registrations.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Never registered through the portal.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {detail.registrations.map((r) => (
                    <li key={r.id} className="rounded border bg-muted/30 px-2 py-1.5 text-xs">
                      <div className="flex items-baseline justify-between gap-2">
                        <Link
                          href={`/admin/users/${encodeURIComponent(r.phone)}`}
                          className="font-medium hover:underline"
                        >
                          {r.anonymized ? "(anonymized)" : r.name}
                        </Link>
                        <span className="shrink-0 text-muted-foreground">
                          {new Date(r.authorizedAt).toLocaleString("en-GB")}
                        </span>
                      </div>
                      <div className="text-muted-foreground">
                        {[
                          r.label,
                          r.location,
                          r.room ? `room ${r.room}` : null,
                          r.ssid,
                          `${formatDuration(r.durationMin * 60)} plan`,
                          r.revokedAt ? "revoked" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Connection history — 30 days ({detail.sessions.length})
              </h4>
              {detail.sessions.length === 0 ? (
                <p className="text-xs text-muted-foreground">No sessions recorded.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-0.5 pr-2 font-normal"><SortLabel label="Start" k="start" sort={sessions.sort} onToggle={sessions.toggle} /></th>
                      <th className="py-0.5 pr-2 font-normal"><SortLabel label="Length" k="length" sort={sessions.sort} onToggle={sessions.toggle} /></th>
                      <th className="py-0.5 pr-2 font-normal"><SortLabel label="Via" k="via" sort={sessions.sort} onToggle={sessions.toggle} /></th>
                      <th className="py-0.5 font-normal"><SortLabel label="↓ / ↑" k="traffic" sort={sessions.sort} onToggle={sessions.toggle} /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.sorted.map((s, i) => (
                      <tr key={i} className="border-t border-border/50">
                        <td className="py-0.5 pr-2 whitespace-nowrap">
                          {s.start ? new Date(s.start * 1000).toLocaleString("en-GB") : "-"}
                        </td>
                        <td className="py-0.5 pr-2">
                          {s.durationSec != null ? formatDuration(s.durationSec) : "-"}
                        </td>
                        <td className="py-0.5 pr-2">{s.ap ?? (s.ip ? "wired" : "-")}</td>
                        <td className="py-0.5 whitespace-nowrap">
                          {formatBytes(s.rxBytes)} / {formatBytes(s.txBytes)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}


type JourneyData = {
  health: { score: number; label: string; reasons: string[] };
  journey: { time: number; kind: string; text: string; ap?: string }[];
  windowHours: number;
  watched: boolean;
};

/** Health score + the client's controller-event journey (7 days), fetched on
 * expand — Catalyst Client 360's idea at floating-window size. */
function HealthJourney({ mac }: { mac: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<JourneyData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setOpen(false);
    setData(null);
    setErr(null);
  }, [mac]);

  useEffect(() => {
    if (!open || data !== null) return;
    let live = true;
    fetch(`/api/admin/clients/${encodeURIComponent(mac)}/journey`)
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        if (d.health) setData(d);
        else setErr(d.error ?? "Could not load the journey.");
      })
      .catch(() => live && setErr("Network error while loading the journey."));
    return () => {
      live = false;
    };
  }, [open, data, mac]);

  const tone = (label: string) =>
    label === "good"
      ? "text-green-600 dark:text-green-400"
      : label === "fair"
        ? "text-amber-600 dark:text-amber-400"
        : label === "poor"
          ? "text-destructive"
          : "text-muted-foreground";

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        Health &amp; journey {open ? "▾" : "▸"}
      </button>
      {open && (
        <>
          {err && <p className="text-xs text-destructive">{err}</p>}
          {!err && data === null && <p className="text-xs text-muted-foreground">Loading…</p>}
          {data && (
            <div className="space-y-2 text-xs">
              <p className="flex flex-wrap items-center gap-2">
                <span className={`font-semibold ${tone(data.health.label)}`}>
                  {data.health.score}/10 {data.health.label}
                </span>{" "}
                <span className="text-muted-foreground">— {data.health.reasons.join("; ")}</span>
                <button
                  type="button"
                  className="rounded border px-1.5 py-0.5 text-[11px] hover:bg-muted"
                  title="A watched client opens an alert whenever it connects"
                  onClick={async () => {
                    const res = await fetch(
                      data.watched
                        ? `/api/admin/watchlist?mac=${encodeURIComponent(mac)}`
                        : "/api/admin/watchlist",
                      data.watched
                        ? { method: "DELETE" }
                        : {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ mac }),
                          },
                    ).catch(() => null);
                    if (res?.ok) setData({ ...data, watched: !data.watched });
                  }}
                >
                  {data.watched ? "★ Watched — unwatch" : "☆ Watch"}
                </button>
              </p>
              {data.journey.length === 0 ? (
                <p className="text-muted-foreground">
                  No client events in the last {Math.round(data.windowHours / 24)} days.
                </p>
              ) : (
                <ul className="max-h-48 space-y-0.5 overflow-y-auto">
                  {data.journey.map((j, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="shrink-0 font-mono text-muted-foreground">
                        {new Date(j.time).toISOString().slice(5, 16).replace("T", " ")}
                      </span>
                      <span
                        className={`shrink-0 ${
                          j.kind === "connect"
                            ? "text-green-600 dark:text-green-400"
                            : j.kind === "disconnect"
                              ? "text-destructive"
                              : j.kind === "roam"
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-muted-foreground"
                        }`}
                      >
                        {j.kind}
                      </span>
                      <span className="min-w-0 truncate" title={j.text}>
                        {j.text}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
