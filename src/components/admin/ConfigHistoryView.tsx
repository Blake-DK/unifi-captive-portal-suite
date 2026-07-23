"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type SnapshotRow = {
  id: number;
  takenAt: string;
  hash: string;
  summary: Record<string, { added: number; removed: number; changed: number }> | null;
};

type DiffLine = { type: "same" | "add" | "del"; text: string };

/** Version list + two-version picker + colored per-collection line diff. */
export function ConfigHistoryView({ snapshots }: { snapshots: SnapshotRow[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<number[]>([]);
  const [diff, setDiff] = useState<Record<string, DiffLine[]> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const toggle = (id: number) => {
    setDiff(null);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]));
  };

  const loadDiff = async () => {
    if (picked.length !== 2) return;
    setBusy("diff");
    setNote(null);
    try {
      const res = await fetch(`/api/admin/config-history/diff?a=${picked[0]}&b=${picked[1]}`);
      const d = await res.json();
      if (!res.ok) setNote(d.error ?? "Diff failed");
      else setDiff(d.collections);
    } catch {
      setNote("Network error");
    } finally {
      setBusy(null);
    }
  };

  const snapshotNow = async () => {
    setBusy("snap");
    setNote(null);
    try {
      const res = await fetch("/api/admin/config-history", { method: "POST" });
      const d = await res.json();
      setNote(
        !res.ok
          ? (d.error ?? "Snapshot failed")
          : d.changed
            ? d.baseline
              ? "Baseline snapshot stored."
              : "Change detected — new version stored."
            : (d.skipped ?? "No change since the last version."),
      );
      router.refresh();
    } catch {
      setNote("Network error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={snapshotNow} disabled={busy !== null}>
          {busy === "snap" ? "Snapshotting…" : "Snapshot now"}
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href="/api/admin/config-history/backup">Download .unf backup</a>
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={loadDiff}
          disabled={picked.length !== 2 || busy !== null}
        >
          {busy === "diff" ? "Diffing…" : `Diff selected (${picked.length}/2)`}
        </Button>
        {note && <span className="text-sm text-muted-foreground">{note}</span>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {snapshots.length} version{snapshots.length !== 1 ? "s" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {snapshots.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No versions yet — take a snapshot or enable the hourly watch.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {snapshots.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={picked.includes(s.id)}
                      onChange={() => toggle(s.id)}
                    />
                    <span className="font-mono text-xs">#{s.id}</span>
                    <span>{s.takenAt.slice(0, 16).replace("T", " ")} UTC</span>
                    <span className="font-mono text-xs text-muted-foreground">{s.hash}</span>
                  </label>
                  {s.summary ? (
                    Object.entries(s.summary).map(([k, v]) => (
                      <span
                        key={k}
                        className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {k}: +{v.added} −{v.removed} ~{v.changed}
                      </span>
                    ))
                  ) : (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      baseline
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {diff && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Diff #{Math.min(...picked)} → #{Math.max(...picked)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.keys(diff).length === 0 && (
              <p className="text-sm text-muted-foreground">The selected versions are identical.</p>
            )}
            {Object.entries(diff).map(([key, lines]) => (
              <div key={key}>
                <p className="mb-1 text-sm font-medium">{key}</p>
                <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-2 text-[11px] leading-4">
                  {lines.map((l, i) => (
                    <div
                      key={i}
                      className={
                        l.type === "add"
                          ? "bg-green-500/15 text-green-700 dark:text-green-400"
                          : l.type === "del"
                            ? "bg-red-500/15 text-red-700 dark:text-red-400"
                            : "text-muted-foreground"
                      }
                    >
                      {l.type === "add" ? "+ " : l.type === "del" ? "− " : "  "}
                      {l.text}
                    </div>
                  ))}
                </pre>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
