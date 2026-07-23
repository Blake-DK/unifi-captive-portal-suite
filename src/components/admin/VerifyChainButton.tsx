"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Runs the hash-chain verification over the whole audit log and reports
 * the verdict inline. Full-admin only (the page itself is gated). */
export function VerifyChainButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [bad, setBad] = useState(false);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/audit/verify", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBad(true);
        setResult(d.error ?? "Verification failed to run.");
        return;
      }
      setBad(!d.ok);
      setResult(
        d.ok
          ? `Chain intact: ${d.checked} row${d.checked !== 1 ? "s" : ""} verified` +
              (d.unverifiable > 0 ? `, ${d.unverifiable} older row${d.unverifiable !== 1 ? "s" : ""} predate the chain` : "") +
              "."
          : `CHAIN BROKEN at row ${d.firstBreakId} — a stored entry was altered or removed. ` +
              `${d.checked} row(s) before it verified.`,
      );
    } catch {
      setBad(true);
      setResult("Network error while verifying.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" size="sm" onClick={run} disabled={busy}>
        {busy ? "Verifying…" : "Verify chain"}
      </Button>
      {result && (
        <span className={`text-sm ${bad ? "font-medium text-destructive" : "text-muted-foreground"}`}>
          {result}
        </span>
      )}
    </div>
  );
}
