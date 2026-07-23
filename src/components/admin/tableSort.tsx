"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { compareCellsDirected } from "@/lib/tableSort";

/**
 * Column sorting for client-side data tables. Define the accessor map at
 * module scope (it maps column key → sortable value per row) and render the
 * headers with SortableHead. Clicking a header cycles ascending, descending,
 * then back to the natural order. Server-rendered tables use SortableTable
 * (the DOM enhancer) instead.
 */

export type SortState = { key: string; dir: "asc" | "desc" } | null;

export type SortAccessors<T> = Record<string, (row: T) => unknown>;

export function useTableSort<T>(rows: T[], accessors: SortAccessors<T>) {
  const [sort, setSort] = useState<SortState>(null);
  const toggle = (key: string) =>
    setSort((s) =>
      s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null,
    );
  const sorted = useMemo(() => {
    const acc = sort ? accessors[sort.key] : undefined;
    if (!sort || !acc) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return rows
      .map((row, i) => ({ row, i }))
      .sort((a, b) => compareCellsDirected(acc(a.row), acc(b.row), dir) || a.i - b.i)
      .map((x) => x.row);
  }, [rows, sort, accessors]);
  return { sorted, sort, toggle };
}

/** The clickable label + direction arrow, for raw <th> cells. */
export function SortLabel({
  label,
  k,
  sort,
  onToggle,
}: {
  label: ReactNode;
  k: string;
  sort: SortState;
  onToggle: (key: string) => void;
}) {
  const active = sort?.key === k;
  return (
    <button
      type="button"
      onClick={() => onToggle(k)}
      className="inline-flex items-center gap-1 hover:text-foreground"
      title="Sort by this column"
    >
      {label}
      {active ? (
        sort!.dir === "asc" ? (
          <ArrowUp aria-hidden className="h-3 w-3 shrink-0" />
        ) : (
          <ArrowDown aria-hidden className="h-3 w-3 shrink-0" />
        )
      ) : (
        <ArrowUpDown aria-hidden className="h-3 w-3 shrink-0 opacity-30" />
      )}
    </button>
  );
}

/** A ui/table TableHead whose title sorts its column. */
export function SortableHead({
  label,
  k,
  sort,
  onToggle,
  className,
}: {
  label: ReactNode;
  k: string;
  sort: SortState;
  onToggle: (key: string) => void;
  className?: string;
}) {
  const active = sort?.key === k;
  return (
    <TableHead
      className={className}
      aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <SortLabel label={label} k={k} sort={sort} onToggle={onToggle} />
    </TableHead>
  );
}
