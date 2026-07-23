"use client";
import { useState } from "react";
import type { TopoNode } from "@/lib/topology";
import { TableCell, TableRow } from "@/components/ui/table";
import { DeviceDialog, type DeviceIssue } from "./DeviceDialog";

/**
 * The Network Status device table's body. Client-side only so a row click can
 * open the same per-device dialog the map uses; the cells themselves are
 * rendered on the server and passed through as `cells`.
 */
export function StatusDeviceRows({
  rows,
  canControl,
  canIgnore,
  issuesByDevice,
}: {
  rows: { node: TopoNode; cells: React.ReactNode }[];
  canControl: boolean;
  canIgnore: boolean;
  issuesByDevice: Record<string, DeviceIssue[]>;
}) {
  const [selected, setSelected] = useState<TopoNode | null>(null);

  // A drag-select on a MAC/name ends in a click; an active selection means
  // the user was copying, not opening. No role override — a <tr> that stops
  // being a row hides its cells from assistive technology; keyboard access
  // comes from tabIndex + Enter/Space alone.
  const open = (node: TopoNode) => {
    if (window.getSelection()?.toString()) return;
    setSelected(node);
  };

  return (
    <>
      {rows.map(({ node, cells }) => (
        <TableRow
          key={node.mac}
          tabIndex={0}
          aria-label={`Open ${node.name}`}
          className="cursor-pointer"
          onClick={() => open(node)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              open(node);
            }
          }}
        >
          {cells}
        </TableRow>
      ))}
      <DeviceDialog
        node={selected}
        onClose={() => setSelected(null)}
        canControl={canControl}
        canIgnore={canIgnore}
        issues={selected ? (issuesByDevice[selected.mac.toLowerCase()] ?? []) : []}
      />
    </>
  );
}

/** Kept beside the rows so an empty table renders the same <TableCell> shape. */
export function StatusEmptyRow({ text, colSpan }: { text: string; colSpan: number }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="text-center text-muted-foreground">
        {text}
      </TableCell>
    </TableRow>
  );
}
