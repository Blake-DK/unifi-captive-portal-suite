"use client";

import { proximity } from "@/lib/rogueApLocate";

/**
 * A radial "where is it" plot for one rogue/neighbour AP. The rogue sits at the
 * centre; each of our APs that heard it is placed at a radius set by signal
 * strength (louder = closer to the centre), so the AP nearest the middle is the
 * one it is physically closest to. Angle is illustrative only — RSSI gives range,
 * not bearing — so the APs are just fanned out evenly for legibility.
 */

type MapSighting = { apMac: string; apName: string; rssi: number };

const CX = 160;
const CY = 160;
const R_MAX = 130;
const R_MIN = 26; // keep even a very-loud AP off the centre marker

// Heat: nearer (louder) reads hotter.
const DOT_COLOR: Record<string, string> = {
  "very-close": "#ef4444",
  near: "#f59e0b",
  far: "#eab308",
  distant: "#94a3b8",
};

function radiusFor(rssi: number): number {
  return Math.max(R_MIN, R_MAX * (1 - proximity(rssi).closeness));
}

export function RogueSignalMap({
  ssid,
  bssid,
  sightings,
  onOpenAp,
}: {
  ssid: string;
  bssid: string;
  sightings: MapSighting[];
  onOpenAp?: (apMac: string) => void;
}) {
  const rings = [-52, -67, -80].map((dbm) => ({ dbm, r: R_MAX * (1 - proximity(dbm).closeness) }));

  return (
    <div className="grid gap-2 sm:grid-cols-[320px_1fr]">
      <svg
        viewBox="0 0 320 320"
        className="mx-auto w-full max-w-[320px] text-muted-foreground"
        role="img"
        aria-label={`Signal map for ${bssid}`}
      >
        {/* signal rings */}
        {rings.map((ring) => (
          <g key={ring.dbm}>
            <circle cx={CX} cy={CY} r={ring.r} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeDasharray="3 3" />
            <text x={CX + ring.r + 2} y={CY} fill="currentColor" className="text-[9px]" dominantBaseline="middle">
              {ring.dbm}
            </text>
          </g>
        ))}
        <circle cx={CX} cy={CY} r={R_MAX} fill="none" stroke="currentColor" strokeOpacity={0.25} />

        {/* spokes + AP dots */}
        {sightings.map((s, i) => {
          const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, sightings.length);
          const r = radiusFor(s.rssi);
          const x = CX + r * Math.cos(angle);
          const y = CY + r * Math.sin(angle);
          const color = DOT_COLOR[proximity(s.rssi).bucket];
          const labelRight = Math.cos(angle) >= 0;
          return (
            <g key={s.apMac} className={onOpenAp ? "cursor-pointer" : undefined} onClick={() => onOpenAp?.(s.apMac)}>
              <line x1={CX} y1={CY} x2={x} y2={y} stroke="currentColor" strokeOpacity={0.2} />
              <circle cx={x} cy={y} r={6} fill={color} stroke="white" strokeWidth={1.5} />
              <text
                x={x + (labelRight ? 9 : -9)}
                y={y}
                textAnchor={labelRight ? "start" : "end"}
                dominantBaseline="middle"
                fill="currentColor"
                className="text-[10px] font-medium text-foreground"
              >
                {s.apName.length > 16 ? `${s.apName.slice(0, 15)}…` : s.apName}
              </text>
              <text
                x={x + (labelRight ? 9 : -9)}
                y={y + 11}
                textAnchor={labelRight ? "start" : "end"}
                dominantBaseline="middle"
                fill="currentColor"
                className="text-[9px]"
              >
                {s.rssi} dBm
              </text>
            </g>
          );
        })}

        {/* the rogue itself, centred */}
        <circle cx={CX} cy={CY} r={9} fill="#dc2626" />
        <text x={CX} y={CY - 14} textAnchor="middle" fill="currentColor" className="text-[10px] font-semibold text-foreground">
          {ssid || "(hidden)"}
        </text>
      </svg>

      <div className="space-y-2 text-xs">
        <p className="text-muted-foreground">
          The rogue is centred; each AP sits at a radius set by how loudly it hears it (rings are dBm). The AP nearest
          the centre is physically closest to it — start there. Bearing is not shown (signal gives range only).
        </p>
        <ol className="space-y-1">
          {sightings.map((s, i) => (
            <li key={s.apMac} className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: DOT_COLOR[proximity(s.rssi).bucket] }} />
              <button
                type="button"
                onClick={() => onOpenAp?.(s.apMac)}
                className="font-medium hover:underline decoration-dotted underline-offset-2"
                title="Open this AP"
              >
                {s.apName}
              </button>
              <span className="text-muted-foreground">
                {s.rssi} dBm · {proximity(s.rssi).label}
                {i === 0 ? " · nearest" : ""}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
