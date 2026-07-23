"use client";

import {
  AreaChart,
  Area,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

/**
 * Shared theme plumbing: every color is a CSS variable so the same chart is
 * correct on the light and dark card surfaces (each mode's palette is
 * validated separately in globals.css). Grid/axes are recessive — the data
 * carries the ink, not the scaffolding.
 */
const PALETTE = [1, 2, 3, 4, 5, 6].map((i) => `var(--chart-${i})`);
const GRID = "hsl(var(--border))";
const TICK = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const tooltipProps = {
  contentStyle: {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 8,
    fontSize: 12,
  },
  labelStyle: { color: "hsl(var(--muted-foreground))" },
  itemStyle: { color: "hsl(var(--card-foreground))" },
} as const;

export function ConnectionsLineChart({ data }: { data: { date: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tick={TICK} axisLine={false} tickLine={false} />
        <YAxis tick={TICK} allowDecimals={false} axisLine={false} tickLine={false} />
        <Tooltip {...tooltipProps} />
        <Line type="monotone" dataKey="count" stroke={PALETTE[0]} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Daily WLAN traffic in GB (single series — the title names it, no legend). */
export function SiteTrafficChart({ data }: { data: { date: string; gb: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tick={TICK} axisLine={false} tickLine={false} />
        <YAxis tick={TICK} tickFormatter={(v: number) => `${v}`} width={44} axisLine={false} tickLine={false} />
        <Tooltip {...tooltipProps} formatter={(v) => [`${Number(v).toFixed(1)} GB`, "Traffic"]} />
        <Area
          type="monotone"
          dataKey="gb"
          stroke={PALETTE[0]}
          strokeWidth={2}
          fill={PALETTE[0]}
          fillOpacity={0.12}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Daily wireless client count (single series). */
export function WirelessClientsChart({ data }: { data: { date: string; clients: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tick={TICK} axisLine={false} tickLine={false} />
        <YAxis tick={TICK} allowDecimals={false} width={44} axisLine={false} tickLine={false} />
        <Tooltip {...tooltipProps} formatter={(v) => [v, "Clients"]} />
        <Line type="monotone" dataKey="clients" stroke={PALETTE[1]} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PeakHoursPieChart({ data }: { data: { label: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={2}
          stroke="hsl(var(--card))"
          strokeWidth={2}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip {...tooltipProps} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconSize={10} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** WAN throughput over time — up + down in Mbps (two series). */
export function ThroughputHistoryChart({ data }: { data: { t: string; up: number | null; down: number | null }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="t" tick={TICK} minTickGap={40} axisLine={false} tickLine={false} />
        <YAxis tick={TICK} width={48} tickFormatter={(v: number) => `${v}`} axisLine={false} tickLine={false} />
        <Tooltip {...tooltipProps} formatter={(v, n) => [`${Number(v).toFixed(1)} Mbps`, n === "down" ? "Down" : "Up"]} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconSize={10} />
        <Area type="monotone" dataKey="down" name="Down" stroke={PALETTE[0]} fill={PALETTE[0]} fillOpacity={0.12} strokeWidth={2} dot={false} />
        <Area type="monotone" dataKey="up" name="Up" stroke={PALETTE[1]} fill={PALETTE[1]} fillOpacity={0.1} strokeWidth={2} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** A single numeric series over time (clients, latency, etc.). */
export function TimeSeriesChart({
  data,
  label,
  color = PALETTE[0],
  unit = "",
}: {
  data: { t: string; v: number | null }[];
  label: string;
  color?: string;
  unit?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="t" tick={TICK} minTickGap={40} axisLine={false} tickLine={false} />
        <YAxis tick={TICK} width={44} allowDecimals={false} axisLine={false} tickLine={false} />
        <Tooltip {...tooltipProps} formatter={(v) => [`${Number(v).toFixed(unit === "%" ? 0 : 1)}${unit}`, label]} />
        <Line type="monotone" dataKey="v" name={label} stroke={color} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Device CPU + memory over time (two % series). */
export function DeviceResourceChart({ data }: { data: { t: string; cpu: number | null; mem: number | null }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="t" tick={TICK} minTickGap={40} axisLine={false} tickLine={false} />
        <YAxis tick={TICK} width={44} domain={[0, 100]} axisLine={false} tickLine={false} />
        <Tooltip {...tooltipProps} formatter={(v, n) => [`${Number(v).toFixed(0)}%`, n === "cpu" ? "CPU" : "Memory"]} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconSize={10} />
        <Line type="monotone" dataKey="cpu" name="CPU" stroke={PALETTE[0]} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="mem" name="Memory" stroke={PALETTE[3]} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function RetentionBarChart({
  data,
}: {
  data: { period: string; newGuests: number; returning: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="period" tick={TICK} axisLine={false} tickLine={false} />
        <YAxis tick={TICK} allowDecimals={false} axisLine={false} tickLine={false} />
        <Tooltip {...tooltipProps} cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconSize={10} />
        <Bar dataKey="newGuests" name="New Guests" fill={PALETTE[0]} radius={[4, 4, 0, 0]} maxBarSize={40} />
        <Bar dataKey="returning" name="Returning" fill={PALETTE[1]} radius={[4, 4, 0, 0]} maxBarSize={40} />
      </BarChart>
    </ResponsiveContainer>
  );
}
