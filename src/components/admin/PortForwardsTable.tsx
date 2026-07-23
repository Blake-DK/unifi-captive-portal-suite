"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ClientLink } from "@/components/admin/ClientWindows";

type Row = {
  key: string;
  id: string | null;
  name: string;
  enabled: boolean;
  source: "port-forward" | "upnp";
  proto: string;
  wanPort: string;
  fwdIp: string;
  fwdPort: string;
  src: string;
  wan: string;
  logged: boolean;
  deviceName: string | null;
  deviceMac: string | null;
  network: string | null;
  note: string;
};

type Group = {
  deviceKey: string;
  deviceLabel: string;
  deviceMac: string | null;
  network: string | null;
  rows: Row[];
};

export function PortForwardsTable({
  groups,
  canEdit,
}: {
  groups: Group[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editFor, setEditFor] = useState<Row | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const openEdit = (r: Row) => {
    setEditFor(r);
    setDraft(r.note);
    setSaveError(null);
  };

  const save = async () => {
    if (!editFor) return;
    setBusy(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/admin/unifi/port-forwards", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: editFor.key, note: draft.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(d.error ?? "Could not save the note.");
        return;
      }
      setEditFor(null);
      router.refresh();
    } catch {
      setSaveError("Network error while saving.");
    } finally {
      setBusy(false);
    }
  };

  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          No inbound port-forwards or UPnP mappings on this site. That is the safest posture — nothing
          on the LAN is reachable from the internet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <Card key={g.deviceKey}>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base">
              <span>{g.deviceLabel}</span>
              {g.deviceMac ? (
                <ClientLink mac={g.deviceMac} hint={g.deviceLabel}>
                  <span className="font-mono text-xs text-muted-foreground">{g.deviceMac}</span>
                </ClientLink>
              ) : (
                <span className="font-mono text-xs text-muted-foreground">offline / unknown</span>
              )}
              {g.network && (
                <span className="rounded bg-muted px-1.5 text-xs font-normal text-muted-foreground">
                  {g.network}
                </span>
              )}
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {g.rows.length} mapping{g.rows.length !== 1 ? "s" : ""}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs">
                  <tr>
                    <th className="p-2">Name</th>
                    <th className="p-2">Type</th>
                    <th className="p-2">WAN port</th>
                    <th className="p-2">→ Internal</th>
                    <th className="p-2">Proto</th>
                    <th className="p-2">Source</th>
                    <th className="p-2">Note</th>
                    {canEdit && <th className="p-2" />}
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.key} className={`border-t ${r.enabled ? "" : "opacity-50"}`}>
                      <td className="p-2">
                        {r.name}
                        {!r.enabled && (
                          <span className="ml-1.5 rounded bg-muted px-1.5 text-xs text-muted-foreground">
                            disabled
                          </span>
                        )}
                      </td>
                      <td className="p-2 text-xs">
                        {r.source === "upnp" ? (
                          <span className="rounded bg-amber-500/15 px-1.5 text-amber-700 dark:text-amber-400">
                            UPnP
                          </span>
                        ) : (
                          <span className="rounded bg-sky-500/15 px-1.5 text-sky-700 dark:text-sky-400">
                            static
                          </span>
                        )}
                      </td>
                      <td className="p-2 font-mono text-xs">
                        {r.wan}:{r.wanPort || "—"}
                      </td>
                      <td className="p-2 font-mono text-xs">
                        {r.fwdIp || "—"}
                        {r.fwdPort ? `:${r.fwdPort}` : ""}
                      </td>
                      <td className="p-2 text-xs uppercase">{r.proto.replace("_", "+")}</td>
                      <td className="p-2 text-xs">
                        {r.src === "any" ? (
                          <span className="text-destructive">any</span>
                        ) : (
                          <span className="font-mono">{r.src}</span>
                        )}
                      </td>
                      <td className="p-2 text-xs text-muted-foreground">
                        {r.note ? <span className="italic">“{r.note}”</span> : "—"}
                      </td>
                      {canEdit && (
                        <td className="p-2 text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => openEdit(r)}
                          >
                            {r.note ? "Edit note" : "Add note"}
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}

      <Dialog open={editFor !== null} onOpenChange={(o) => !o && setEditFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Note — {editFor?.name}</DialogTitle>
            <DialogDescription>
              Document why this forward exists so the next admin doesn&apos;t have to guess. Clearing the
              field removes the note.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Home Assistant remote access — reviewed 2026-07"
                maxLength={500}
              />
            </div>
            {saveError && (
              <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                {saveError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditFor(null)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
