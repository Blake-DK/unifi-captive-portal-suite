"use client";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * What's-new dialog: shown once per release per admin, on the first page
 * load after logging in on a new version. Dismissing it records the version
 * server-side so it never comes back for that release.
 */
export function ChangelogPopup() {
  const [data, setData] = useState<{ version: string; notes: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/changelog")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (!cancelled && d?.show) setData({ version: d.version, notes: d.notes });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = () => {
    setData(null);
    void fetch("/api/admin/changelog", { method: "POST" }).catch(() => {});
  };

  if (!data) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && dismiss()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>What&apos;s new — v{data.version}</DialogTitle>
          <DialogDescription>Latest release notes for this portal.</DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-4 text-sm">
          <ReactMarkdown
            components={{
              // The section heading duplicates the dialog title's version —
              // render it small and muted rather than shouting twice.
              h1: (props) => <h2 className="mb-3 text-sm font-semibold text-muted-foreground" {...props} />,
              h2: (props) => <h2 className="mb-3 text-sm font-semibold text-muted-foreground" {...props} />,
              h3: (props) => <h3 className="mb-2 mt-4 text-sm font-bold first:mt-0" {...props} />,
              ul: (props) => <ul className="mb-3 list-disc space-y-1.5 pl-5" {...props} />,
              li: (props) => <li className="leading-snug" {...props} />,
              p: (props) => <p className="mb-2" {...props} />,
              a: (props) => (
                <a className="underline decoration-muted-foreground/50 hover:text-foreground" target="_blank" rel="noreferrer" {...props} />
              ),
              code: (props) => <code className="rounded bg-muted px-1 font-mono text-xs" {...props} />,
            }}
          >
            {data.notes}
          </ReactMarkdown>
        </div>
        <DialogFooter>
          <Button type="button" onClick={dismiss}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
