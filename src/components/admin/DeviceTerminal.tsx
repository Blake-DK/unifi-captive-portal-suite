"use client";
import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { Button } from "@/components/ui/button";

/**
 * Interactive SSH terminal for a device, over the HTTP long-poll transport.
 * xterm.js is loaded dynamically (client-only, avoids SSR/`self` issues).
 *
 * Addressed by adopted-device MAC by default. `openBody` switches it to an
 * un-adopted host (the rogue-UniFi tab): the open POST carries an IP and
 * optional one-off credentials, while the session transport stays the same
 * (session ids are owner-scoped, not device-scoped).
 */
export function DeviceTerminal({
  mac,
  onClose,
  openBody,
}: {
  mac: string;
  onClose: () => void;
  openBody?: Record<string, unknown>;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed" | "error">("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let sessionId: string | null = null;
    let term: import("@xterm/xterm").Terminal | null = null;
    let observer: ResizeObserver | null = null;
    const base = openBody
      ? "/api/admin/rogue-unifi/terminal"
      : `/api/admin/devices/${encodeURIComponent(mac)}/terminal`;

    (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit").catch(() => ({ FitAddon: null }) as never);
      if (disposed) return;

      term = new Terminal({ convertEol: true, fontSize: 13, cursorBlink: true, theme: { background: "#0b0f19" } });
      let fit: { fit: () => void } | null = null;
      if (FitAddon) {
        fit = new FitAddon();
        term.loadAddon(fit as never);
      }
      if (holderRef.current) term.open(holderRef.current);

      // Refit and tell the remote PTY whenever the box actually changes size.
      // A single fit() at open measured the dialog mid-entrance-animation, so
      // the terminal was sized to a container that didn't exist yet.
      let lastSize = "";
      const refit = () => {
        if (disposed || !term) return;
        fit?.fit();
        const size = `${term.cols}x${term.rows}`;
        if (sessionId && size !== lastSize) {
          lastSize = size;
          void fetch(`${base}/${sessionId}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ resize: { cols: term.cols, rows: term.rows } }),
          });
        }
      };
      refit();
      requestAnimationFrame(refit);
      setTimeout(refit, 250); // after the dialog's entrance animation settles
      if (holderRef.current && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(refit);
        observer.observe(holderRef.current);
      }

      // Open the shell session.
      const res = await fetch(base, {
        method: "POST",
        ...(openBody
          ? { headers: { "content-type": "application/json" }, body: JSON.stringify(openBody) }
          : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.session) {
        setError(data.error ?? "Failed to open shell");
        setStatus("error");
        return;
      }
      sessionId = data.session;
      setStatus("open");
      lastSize = ""; // session just opened — push the current size to the PTY
      refit();

      term.onData((d) => {
        void fetch(`${base}/${sessionId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ data: d }),
        });
      });

      // Long-poll output.
      while (!disposed) {
        const r = await fetch(`${base}/${sessionId}`).catch(() => null);
        if (!r || !r.ok) break;
        const chunk = await r.json().catch(() => ({ closed: true }));
        if (chunk.data) term.write(chunk.data);
        if (chunk.closed) break;
      }
      if (!disposed) setStatus("closed");
    })().catch((e) => {
      setError(e instanceof Error ? e.message : "Terminal error");
      setStatus("error");
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      if (sessionId) void fetch(`${base}/${sessionId}`, { method: "DELETE" });
      term?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mac]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {status === "connecting" && "Connecting…"}
          {status === "open" && "Connected — type below"}
          {status === "closed" && "Session closed"}
          {status === "error" && <span className="text-destructive">{error}</span>}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Close terminal
        </Button>
      </div>
      <div ref={holderRef} className="h-72 w-full overflow-hidden rounded-md border bg-[#0b0f19] p-1" />
    </div>
  );
}
