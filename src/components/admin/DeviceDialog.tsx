"use client";
import { useEffect } from "react";
import type { TopoNode } from "@/lib/topology";
import type { DeviceIssue } from "@/lib/issues";
import { useDeviceWindows } from "./DeviceWindows";

/**
 * Compatibility shim. The per-device popup is now a floating, draggable window
 * (see DeviceWindows) rather than a modal, so several can be open at once and
 * you can click a device in one window's path to open its own. Surfaces still
 * render <DeviceDialog node={selected} onClose={…} /> with a controlled node;
 * when it becomes non-null we open that device's window and clear the surface's
 * selection. canControl/canIgnore/issues are recomputed server-side per window
 * now, so they're accepted for backward compatibility but ignored here.
 */

// Re-exported for surfaces that import the type from here.
export type { DeviceIssue };

export function DeviceDialog({
  node,
  onClose,
}: {
  node: TopoNode | null;
  onClose: () => void;
  canControl?: boolean;
  canIgnore?: boolean;
  issues?: DeviceIssue[];
}) {
  const { open } = useDeviceWindows();
  useEffect(() => {
    if (!node) return;
    open(node.mac, node.name);
    // Clear the surface's selection: the window now owns this device's popup.
    onClose();
    // Open once per distinct selection; onClose resets `node` to null.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.mac]);
  return null;
}
