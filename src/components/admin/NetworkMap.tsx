"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, TriangleAlert, Zap, ChevronDown, ChevronRight, Maximize, Minus, Plus } from "lucide-react";
import type { TopoNode, Topology } from "@/lib/topology";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DeviceDialog } from "./DeviceDialog";
import { DeviceTypeChips, type DeviceTypeFilterValue } from "./DeviceTypeChips";
import { classifyDevice, parseBuildingToken } from "@/lib/deviceType";
import { TYPE_LABEL } from "@/lib/deviceLabels";
import type { DeviceIssue } from "@/lib/issues";

/** Live overlay data, keyed by lowercase MAC (and "mac:port" for flaps). */
export type MapIssues = {
  byDevice: Record<string, DeviceIssue[]>;
  flapsByPort: Record<string, number>;
};

/** One selectable map besides "Whole site": a location or a single building
 * from Settings → Locations. A device belongs when its leading name token
 * (the `<bldg>` part of the naming convention) equals one of `tokens`; its
 * uplink path to the core stays visible (dimmed) like any filtered view. */
export type MapView = { id: string; label: string; group: string; tokens: string[] };

const NO_ISSUES: MapIssues = { byDevice: {}, flapsByPort: {} };

function nodeAccent(n: TopoNode): string {
  if (n.online) return "border-l-green-500";
  if (n.state === 0) return "border-l-red-500";
  return "border-l-amber-500";
}

function NodeCard({
  node,
  onSelect,
  issues,
  uplinkFlaps,
  dimmed = false,
  collapsed = false,
  hiddenCount = 0,
  onToggleCollapse,
}: {
  node: TopoNode;
  onSelect: (n: TopoNode) => void;
  issues: { severity: "error" | "warning"; text: string }[];
  uplinkFlaps?: number;
  dimmed?: boolean;
  collapsed?: boolean;
  hiddenCount?: number;
  onToggleCollapse?: () => void;
}) {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  const token = classifyDevice(node.name, node.type, node.model);
  return (
    <button
      type="button"
      data-mac={node.mac}
      onClick={() => onSelect(node)}
      className={`w-56 shrink-0 rounded-md border border-l-4 bg-card p-3 text-left shadow-sm transition-all hover:bg-muted ${nodeAccent(node)} ${dimmed ? "opacity-40 hover:opacity-100" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1">
          {onToggleCollapse && (
            <span
              role="button"
              tabIndex={0}
              title={collapsed ? `Expand ${hiddenCount} device(s)` : "Collapse"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse();
              }}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted-foreground/10"
            >
              {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </span>
          )}
          <span className="truncate font-medium">{node.name}</span>
          {collapsed && hiddenCount > 0 && (
            <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">+{hiddenCount}</span>
          )}
        </span>
        <span className="flex items-center gap-1.5">
          {errors > 0 && (
            <span className="inline-flex items-center gap-0.5 text-xs text-red-600 dark:text-red-400" title={issues.filter((i) => i.severity === "error").map((i) => i.text).join("\n")}>
              <CircleAlert className="h-3.5 w-3.5" /> {errors}
            </span>
          )}
          {warnings > 0 && (
            <span className="inline-flex items-center gap-0.5 text-xs text-amber-600 dark:text-amber-400" title={issues.filter((i) => i.severity === "warning").map((i) => i.text).join("\n")}>
              <TriangleAlert className="h-3.5 w-3.5" /> {warnings}
            </span>
          )}
          <span className={`text-xs ${node.online ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
            {node.online ? "●" : "○"}
          </span>
        </span>
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {token && (
          <span className="mr-1 rounded bg-sky-100 px-1 py-px text-[10px] font-medium text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">
            {token}
          </span>
        )}
        {TYPE_LABEL[node.type] ?? node.type}
        {node.model ? ` · ${node.model}` : ""}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        {node.ip && <span className="font-mono">{node.ip}</span>}
        {node.clients > 0 && <span>{node.clients} clients</span>}
        {node.portsUp !== undefined && <span>{node.portsUp}/{node.ports} ports</span>}
        {node.upgradable && <span className="text-amber-600 dark:text-amber-400">update</span>}
      </div>
      {node.uplinkPortIdx !== undefined && (
        <div className={`mt-1 text-[11px] ${uplinkFlaps ? "font-medium text-amber-600 dark:text-amber-400" : "text-muted-foreground/80"}`}>
          ↑ port {node.uplinkPortIdx}
          {node.uplinkSpeed ? ` · ${node.uplinkSpeed >= 1000 ? `${node.uplinkSpeed / 1000}G` : `${node.uplinkSpeed}M`}` : ""}
          {node.uplinkPoe ? ` · ${node.uplinkPoe.toFixed(0)}W` : ""}
          {node.wirelessUplink ? " · mesh" : ""}
          {uplinkFlaps ? (
            <span className="ml-1 inline-flex items-center gap-0.5">
              <Zap className="h-3 w-3" /> {uplinkFlaps} flaps/24h
            </span>
          ) : null}
        </div>
      )}
    </button>
  );
}

/** True if the node's name-token matches the active AP/DN/AN filter. */
function nodeMatchesType(node: TopoNode, active: DeviceTypeFilterValue): boolean {
  if (active === "all") return true;
  const t = classifyDevice(node.name, node.type, node.model);
  return active === "unknown" ? t === null : t === active;
}

/** Count of visible descendants under a node (for the collapsed "+N" badge). */
function countDescendants(node: TopoNode, visible: (n: TopoNode) => boolean): number {
  let n = 0;
  for (const c of node.children) {
    if (visible(c)) n += 1 + countDescendants(c, visible);
  }
  return n;
}

/** Recursive tree: each node above its children, connected by a rail. */
function TreeNode({
  node,
  parentMac,
  onSelect,
  issues,
  matched,
  visible,
  filterActive,
  collapsed,
  onToggleCollapse,
}: {
  node: TopoNode;
  parentMac?: string;
  onSelect: (n: TopoNode) => void;
  issues: MapIssues;
  matched: (n: TopoNode) => boolean; // passes the current type/search filter
  visible: (n: TopoNode) => boolean; // node or a descendant matches → render it
  filterActive: boolean;
  collapsed: Set<string>;
  onToggleCollapse: (mac: string) => void;
}) {
  // The uplink lands on the PARENT's port, so flaps are keyed there.
  const uplinkFlaps =
    parentMac && node.uplinkPortIdx !== undefined
      ? issues.flapsByPort[`${parentMac.toLowerCase()}:${node.uplinkPortIdx}`]
      : undefined;
  const isCollapsed = collapsed.has(node.mac);
  const shownChildren = node.children.filter((c) => !filterActive || visible(c));
  const hasChildren = shownChildren.length > 0;
  return (
    <div className="flex flex-col items-center">
      <NodeCard
        node={node}
        onSelect={onSelect}
        issues={issues.byDevice[node.mac.toLowerCase()] ?? []}
        uplinkFlaps={uplinkFlaps}
        // Dim a node that doesn't itself match but is only shown as an ancestor.
        dimmed={filterActive && !matched(node)}
        collapsed={isCollapsed}
        hiddenCount={countDescendants(node, (n) => !filterActive || visible(n))}
        onToggleCollapse={hasChildren ? () => onToggleCollapse(node.mac) : undefined}
      />
      {hasChildren && !isCollapsed && (
        <>
          <div className="h-5 w-px bg-border" />
          <div className="flex items-start gap-6 border-t border-border pt-5">
            {shownChildren.map((c) => (
              <TreeNode
                key={c.mac}
                node={c}
                parentMac={node.mac}
                onSelect={onSelect}
                issues={issues}
                matched={matched}
                visible={visible}
                filterActive={filterActive}
                collapsed={collapsed}
                onToggleCollapse={onToggleCollapse}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Count devices by name-token across the whole tree, for the filter chips. */
function countByType(topology: Topology): Record<DeviceTypeFilterValue, number> {
  const c: Record<DeviceTypeFilterValue, number> = { all: 0, AP: 0, DN: 0, AN: 0, CN: 0, CAN: 0, UBB: 0, unknown: 0 };
  const walk = (n: TopoNode) => {
    c.all++;
    c[classifyDevice(n.name, n.type) ?? "unknown"]++;
    n.children.forEach(walk);
  };
  topology.roots.forEach(walk);
  return c;
}

type StatusFilter = "all" | "online" | "offline";

export function NetworkMap({
  topology,
  canControl,
  issues = NO_ISSUES,
  canIgnore = false,
  mapViews = [],
}: {
  topology: Topology;
  canControl: boolean;
  issues?: MapIssues;
  /** Operator+ may ignore an offline device site-wide. */
  canIgnore?: boolean;
  /** Building/location maps from Settings → Locations. */
  mapViews?: MapView[];
}) {
  const [selected, setSelected] = useState<TopoNode | null>(null);
  const [devType, setDevType] = useState<DeviceTypeFilterValue>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [mapId, setMapId] = useState("site");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const activeMap = mapViews.find((m) => m.id === mapId) ?? null;
  const mapTokens = useMemo(() => new Set(activeMap?.tokens ?? []), [activeMap]);
  const typeCounts = countByType(topology);
  const onlineCount = useMemo(() => {
    let n = 0;
    const walk = (x: TopoNode) => {
      if (x.online) n++;
      x.children.forEach(walk);
    };
    topology.roots.forEach(walk);
    return n;
  }, [topology]);

  const q = query.trim().toLowerCase();
  const filterActive = devType !== "all" || status !== "all" || q !== "" || activeMap !== null;
  // A node matches when it passes the building map, the type chip, the status
  // chip AND the search box. On a building map the uplink chain to the core
  // still renders (dimmed) via the ancestor rule below — that's the path.
  const matched = (n: TopoNode) => {
    if (activeMap) {
      const b = parseBuildingToken(n.name);
      if (b === null || !mapTokens.has(b)) return false;
    }
    return (
      nodeMatchesType(n, devType) &&
      (status === "all" || (status === "online" ? n.online : !n.online)) &&
      (!q ||
        (n.name ?? "").toLowerCase().includes(q) ||
        n.mac.toLowerCase().includes(q) ||
        (n.ip ?? "").toLowerCase().includes(q))
    );
  };

  // Render a node when it — or any descendant — matches, so filtering PRUNES
  // whole non-matching subtrees instead of just dimming a huge tree.
  const visibleSet = useMemo(() => {
    const set = new Set<string>();
    const walk = (n: TopoNode): boolean => {
      let hit = matched(n);
      for (const c of n.children) if (walk(c)) hit = true;
      if (hit) set.add(n.mac);
      return hit;
    };
    topology.roots.forEach(walk);
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topology, devType, status, q, mapId]);
  const visible = (n: TopoNode) => visibleSet.has(n.mac);

  const parentMacs = useMemo(() => {
    const macs: string[] = [];
    const walk = (n: TopoNode) => {
      if (n.children.length > 0) macs.push(n.mac);
      n.children.forEach(walk);
    };
    topology.roots.forEach(walk);
    return macs;
  }, [topology]);

  const toggleCollapse = (mac: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      n.has(mac) ? n.delete(mac) : n.add(mac);
      return n;
    });

  const shownRoots = topology.roots.filter((r) => !filterActive || visible(r));

  // --- pan/zoom canvas -------------------------------------------------------
  // The tree is plain DOM laid out by flexbox; navigation is a CSS transform
  // (translate+scale) on the content layer inside a fixed-height viewport.
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{
    startDist: number;
    startScale: number;
    startX: number;
    startY: number;
    midX: number;
    midY: number;
  } | null>(null);
  const panStart = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  // A drag must not fire the card's click when the pointer is released.
  const movedRef = useRef(false);

  const clampScale = (s: number) => Math.min(2.5, Math.max(0.15, s));

  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    setView((v) => {
      const scale = clampScale(v.scale * factor);
      const k = scale / v.scale;
      return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  }, []);

  const fit = useCallback(() => {
    const vp = viewportRef.current;
    const ct = contentRef.current;
    if (!vp || !ct) return;
    // offsetWidth/Height ignore the transform — the unscaled layout size.
    const cw = ct.offsetWidth;
    const ch = ct.offsetHeight;
    if (!cw || !ch) return;
    const scale = clampScale(Math.min(vp.clientWidth / cw, vp.clientHeight / ch, 1) * 0.95);
    setView({
      scale,
      x: Math.max(8, (vp.clientWidth - cw * scale) / 2),
      y: Math.max(8, (vp.clientHeight - ch * scale) / 2),
    });
  }, []);

  /** Slide one node to the middle of the viewport, keeping the current zoom.
   * Works off screen rects, so it is independent of the transform maths. */
  const centerOnMac = useCallback((mac: string) => {
    const vp = viewportRef.current;
    // Quoted attribute value: MAC colons need no escaping (CSS.escape would
    // escape them and never match).
    const el = contentRef.current?.querySelector<HTMLElement>(`[data-mac="${mac}"]`);
    if (!vp || !el) return;
    const v = vp.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    const dx = v.left + v.width / 2 - (e.left + e.width / 2);
    const dy = v.top + v.height / 2 - (e.top + e.height / 2);
    setView((cur) => ({ ...cur, x: cur.x + dx, y: cur.y + dy }));
  }, []);

  // Fit after first layout, and again whenever the visible set changes — a
  // filter that leaves three switches on a wide canvas should put them in
  // front of you, not somewhere off-screen to be hunted for.
  useEffect(() => {
    const raf = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit, devType, status, q, mapId, collapsed]);

  // React attaches wheel listeners passively — zooming needs preventDefault,
  // so the handler goes on natively with passive:false.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015));
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: React.PointerEvent) => {
    // Deliberately NOT setPointerCapture here: capturing on the viewport
    // retargets pointerup away from the node card, so the browser never fires
    // its click and devices stop opening. Capture only once a drag actually
    // starts (see onPointerMove).
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    movedRef.current = false;
    if (pointers.current.size === 1) {
      panStart.current = { px: e.clientX, py: e.clientY, x: viewRef.current.x, y: viewRef.current.y };
      pinch.current = null;
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        startScale: viewRef.current.scale,
        startX: viewRef.current.x,
        startY: viewRef.current.y,
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
      };
      panStart.current = null;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const g = pinch.current;
      const scale = clampScale(g.startScale * (Math.hypot(a.x - b.x, a.y - b.y) / g.startDist));
      const rect = viewportRef.current!.getBoundingClientRect();
      const cx = g.midX - rect.left;
      const cy = g.midY - rect.top;
      const k = scale / g.startScale;
      setView({ scale, x: cx - (cx - g.startX) * k, y: cy - (cy - g.startY) * k });
      movedRef.current = true;
    } else if (panStart.current) {
      const dx = e.clientX - panStart.current.px;
      const dy = e.clientY - panStart.current.py;
      // Below the threshold this is still a click-in-progress: don't pan and
      // don't grab the pointer, or the card never gets its click.
      if (!movedRef.current && Math.abs(dx) + Math.abs(dy) <= 5) return;
      if (!movedRef.current) {
        movedRef.current = true;
        try {
          viewportRef.current?.setPointerCapture(e.pointerId);
        } catch {
          // capture is best-effort; panning still works without it
        }
      }
      const p = panStart.current;
      setView((v) => ({ ...v, x: p.x + dx, y: p.y + dy }));
    }
  };

  const onPointerEnd = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 1) {
      const [p] = [...pointers.current.values()];
      panStart.current = { px: p.x, py: p.y, x: viewRef.current.x, y: viewRef.current.y };
    } else if (pointers.current.size === 0) {
      panStart.current = null;
    }
  };

  /** Card click: bring the device to the middle, then open its details — so
   * closing the dialog leaves you looking at the device you just inspected. */
  const selectAndCenter = useCallback(
    (node: TopoNode) => {
      centerOnMac(node.mac);
      setSelected(node);
    },
    [centerOnMac],
  );

  const onClickCapture = (e: React.MouseEvent) => {
    if (movedRef.current) {
      e.stopPropagation();
      e.preventDefault();
      movedRef.current = false;
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 px-4 pb-2">
        {mapViews.length > 0 && (
          <>
            <span className="text-xs text-muted-foreground">Map</span>
            <select
              value={mapId}
              onChange={(e) => setMapId(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="site">Whole site</option>
              {[...new Set(mapViews.map((m) => m.group))].map((g) => (
                <optgroup key={g} label={g}>
                  {mapViews
                    .filter((m) => m.group === g)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </>
        )}
        <span className="text-xs text-muted-foreground">Type</span>
        <DeviceTypeChips value={devType} onChange={setDevType} counts={typeCounts} />
        <span className="text-xs text-muted-foreground">Status</span>
        <div className="flex gap-1">
          {(
            [
              ["all", `All ${topology.totalDevices}`],
              ["online", `Online ${onlineCount}`],
              ["offline", `Offline ${topology.totalDevices - onlineCount}`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              aria-pressed={status === value}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${
                status === value ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name / IP / MAC…"
          className="h-8 w-56"
        />
        <Button type="button" variant="outline" size="sm" onClick={() => setCollapsed(new Set(parentMacs))}>
          Collapse all
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setCollapsed(new Set())}>
          Expand all
        </Button>
        {filterActive && (
          <span className="text-xs text-muted-foreground">
            {visibleSet.size} shown{activeMap ? ` · ${activeMap.label}` : ""}
            {q ? ` · matching “${query.trim()}”` : ""}
          </span>
        )}
      </div>
      <div
        ref={viewportRef}
        className="relative mx-4 mb-4 h-[70vh] cursor-grab touch-none select-none overflow-hidden rounded-md border bg-muted/20 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={onClickCapture}
        onDoubleClick={fit}
      >
        <div
          ref={contentRef}
          className="flex items-start gap-10 p-4"
          style={{
            width: "max-content",
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transformOrigin: "0 0",
          }}
        >
          {shownRoots.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No devices match the current filter.</p>
          ) : (
            shownRoots.map((root) => (
              <TreeNode
                key={root.mac}
                node={root}
                onSelect={selectAndCenter}
                issues={issues}
                matched={matched}
                visible={visible}
                filterActive={filterActive}
                collapsed={collapsed}
                onToggleCollapse={toggleCollapse}
              />
            ))
          )}
        </div>
        <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-md border bg-background/95 p-1 shadow-sm">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            aria-label="Zoom out"
            onClick={() => {
              const vp = viewportRef.current;
              if (vp) zoomAt(vp.clientWidth / 2, vp.clientHeight / 2, 1 / 1.25);
            }}
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span className="w-11 text-center text-xs tabular-nums">{Math.round(view.scale * 100)}%</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            aria-label="Zoom in"
            onClick={() => {
              const vp = viewportRef.current;
              if (vp) zoomAt(vp.clientWidth / 2, vp.clientHeight / 2, 1.25);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            aria-label="Fit to view"
            title="Fit to view (double-click the canvas)"
            onClick={fit}
          >
            <Maximize className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-1.5 text-xs"
            onClick={() => setView({ x: 12, y: 12, scale: 1 })}
          >
            100%
          </Button>
        </div>
      </div>

      <DeviceDialog
        node={selected}
        onClose={() => setSelected(null)}
        canControl={canControl}
        canIgnore={canIgnore}
        issues={selected ? (issues.byDevice[selected.mac.toLowerCase()] ?? []) : []}
      />
    </>
  );
}
