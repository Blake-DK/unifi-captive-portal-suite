"use client";

import {
  DEVICE_TYPE_FILTER_VALUES,
  DEVICE_TYPE_LABELS,
  type DeviceTypeFilterValue,
} from "@/lib/deviceType";

// Re-exported so existing client importers (NetworkMap, PortInventoryTable)
// keep working; the runtime source of truth is lib/deviceType (server-safe).
export type { DeviceTypeFilterValue };

function chipLabel(v: DeviceTypeFilterValue): string {
  return v === "all" ? "All" : v === "unknown" ? "Unknown" : v;
}

function chipTitle(v: DeviceTypeFilterValue): string | undefined {
  return v === "all" || v === "unknown" ? undefined : DEVICE_TYPE_LABELS[v];
}

/**
 * Shared AP/DN/AN device-type filter, matched against the site naming
 * convention's type token. `counts` (optional) shows how many devices fall in
 * each bucket. Reused wherever multiple devices are listed.
 */
export function DeviceTypeChips({
  value,
  onChange,
  counts,
}: {
  value: DeviceTypeFilterValue;
  onChange: (v: DeviceTypeFilterValue) => void;
  counts?: Partial<Record<DeviceTypeFilterValue, number>>;
}) {
  // Hide a named/unknown chip with no devices so networks without a class
  // (e.g. no core nodes) don't show empty CN/UBB chips. "All" always shows,
  // and the active chip stays visible even at zero so the UI can't strand it.
  const shown = DEVICE_TYPE_FILTER_VALUES.filter(
    (v) => v === "all" || v === value || !counts || (counts[v] ?? 0) > 0,
  );
  return (
    <div className="flex overflow-hidden rounded-md border">
      {shown.map((v) => (
        <button
          key={v}
          type="button"
          title={chipTitle(v)}
          onClick={() => onChange(v)}
          className={`px-3 py-1.5 text-sm ${
            value === v ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
          }`}
        >
          {chipLabel(v)}
          {counts ? ` (${counts[v] ?? 0})` : ""}
        </button>
      ))}
    </div>
  );
}
