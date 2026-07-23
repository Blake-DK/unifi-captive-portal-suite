"use client";
import { LineChart, Line, YAxis } from "recharts";

/**
 * Tiny inline usage trend for table cells. The total next to it (rendered by
 * the caller) is the readable value; the sparkline only shows shape, so it
 * has no axes, grid, or tooltip — `title` carries the hover detail instead.
 */
export function UsageSparkline({
  points,
  title,
}: {
  points: { time: number; bytes: number }[];
  title?: string;
}) {
  if (points.length === 0 || points.every((p) => p.bytes === 0)) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <span title={title} className="inline-block align-middle">
      <LineChart width={96} height={28} data={points} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <YAxis hide domain={[0, "dataMax"]} />
        <Line type="monotone" dataKey="bytes" stroke="var(--chart-1)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </span>
  );
}
