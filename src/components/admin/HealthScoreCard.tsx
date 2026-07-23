import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import type { HealthBand } from "@/lib/healthScore";

const BAND_STYLE: Record<HealthBand, { ring: string; text: string }> = {
  good: { ring: "text-green-600 dark:text-green-400", text: "text-green-700 dark:text-green-400" },
  fair: { ring: "text-amber-500 dark:text-amber-400", text: "text-amber-700 dark:text-amber-400" },
  poor: { ring: "text-red-600 dark:text-red-400", text: "text-red-700 dark:text-red-400" },
};

/** Dashboard rollup: a 0–100 network-health score as a ring + the factors behind it. */
export function HealthScoreCard({
  score,
  band,
  label,
  factors,
}: {
  score: number;
  band: HealthBand;
  label: string;
  factors: string[];
}) {
  const s = BAND_STYLE[band];
  const r = 26;
  const circ = 2 * Math.PI * r;
  return (
    <Card>
      <CardContent className="flex items-center gap-4 pt-6">
        <div className="relative h-20 w-20 shrink-0">
          <svg viewBox="0 0 64 64" className="h-20 w-20 -rotate-90">
            <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="text-muted" stroke="currentColor" />
            <circle
              cx="32"
              cy="32"
              r={r}
              fill="none"
              strokeWidth="6"
              strokeLinecap="round"
              className={s.ring}
              stroke="currentColor"
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - score / 100)}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-xl font-bold">{score}</span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">Network health</p>
          <p className={`text-lg font-semibold ${s.text}`}>{label}</p>
          <p className="text-xs text-muted-foreground">
            {factors.length ? factors.join(" · ") : "No open issues"}
            {" — "}
            <Link href="/admin/issues" className="underline">
              details
            </Link>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
