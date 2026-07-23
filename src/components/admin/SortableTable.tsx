"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { compareCellsDirected } from "@/lib/tableSort";

/**
 * Column sorting for SERVER-rendered tables: wrap the <Table> and every
 * header cell with text becomes clickable. Clicking reorders the existing
 * <tr> DOM nodes by that column's cell text (third click restores the
 * server order), so the markup — including client components mounted inside
 * cells — is moved, never recreated.
 *
 * Only for tables whose rows React does not re-render after mount (server
 * components). Client-side data tables re-render on filter changes, which
 * would fight the DOM order — those use useTableSort instead.
 */
export function SortableTable({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const table = ref.current?.querySelector("table");
    const tbody = table?.tBodies[0];
    if (!table || !tbody) return;

    const ths = [...table.querySelectorAll<HTMLTableCellElement>("thead th")];
    const original = [...tbody.rows];
    let state: { idx: number; dir: 1 | -1 } | null = null;

    const paint = () => {
      ths.forEach((th, i) => {
        const arrow = th.querySelector<HTMLElement>("[data-sort-arrow]");
        if (!arrow) return;
        arrow.textContent = state?.idx === i ? (state.dir === 1 ? "▲" : "▼") : "⇅";
        arrow.style.opacity = state?.idx === i ? "1" : "0.3";
        th.setAttribute(
          "aria-sort",
          state?.idx === i ? (state.dir === 1 ? "ascending" : "descending") : "none",
        );
      });
    };

    const apply = () => {
      // Full-width rows (empty states, notes) keep their place at the end.
      const rows = [...tbody.rows];
      const sortable = state
        ? rows.filter((r) => r.cells.length === ths.length)
        : original.filter((r) => r.isConnected);
      const rest = rows.filter((r) => !sortable.includes(r));
      if (state) {
        const { idx, dir } = state;
        sortable.sort((a, b) =>
          compareCellsDirected(
            a.cells[idx]?.textContent?.trim(),
            b.cells[idx]?.textContent?.trim(),
            dir,
          ),
        );
      }
      for (const r of [...sortable, ...rest]) tbody.appendChild(r);
      paint();
    };

    const handlers: { th: HTMLTableCellElement; fn: () => void }[] = [];
    ths.forEach((th, idx) => {
      if (!th.textContent?.trim()) return; // action columns have no title
      const arrow = document.createElement("span");
      arrow.setAttribute("data-sort-arrow", "");
      arrow.style.marginLeft = "0.25rem";
      arrow.style.opacity = "0.3";
      arrow.textContent = "⇅";
      th.appendChild(arrow);
      th.style.cursor = "pointer";
      th.title = "Sort by this column";
      const fn = () => {
        state =
          state?.idx !== idx ? { idx, dir: 1 } : state.dir === 1 ? { idx, dir: -1 } : null;
        apply();
      };
      th.addEventListener("click", fn);
      handlers.push({ th, fn });
    });
    paint();

    return () => {
      for (const { th, fn } of handlers) {
        th.removeEventListener("click", fn);
        th.style.cursor = "";
        th.removeAttribute("aria-sort");
        th.querySelector("[data-sort-arrow]")?.remove();
      }
    };
  }, []);

  return <div ref={ref}>{children}</div>;
}
