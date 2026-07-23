"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DeviceTerminal } from "./DeviceTerminal";
import { SortLabel, useTableSort, type SortAccessors } from "@/components/admin/tableSort";
import { RandomMacBadge } from "@/components/admin/RandomMacBadge";
import { ClientLink } from "@/components/admin/ClientWindows";

type Row = {
  mac: string;
  hostname: string | null;
  ip: string | null;
  vendor: string | null;
  wired: boolean;
  uplink: string | null;
  online: boolean;
  status: "detected" | "marked" | "ignored" | "ignored-until-reconnect";
  note: string;
  reason: string;
};

type FixResult = {
  ok?: boolean;
  username?: string;
  info?: string;
  resetHint?: string;
  attempts?: { username: string; ok: boolean; error?: string }[];
  error?: string;
};

const SORTS: SortAccessors<Row> = {
  status: (r) => `${r.online ? "" : "offline "}${r.status}`,
  mac: (r) => r.mac,
  name: (r) => r.hostname ?? "",
  ip: (r) => r.ip ?? "",
  vendor: (r) => r.vendor ?? "",
  seenOn: (r) => r.uplink ?? (r.wired ? "wired" : ""),
  why: (r) => r.reason,
};

export function RogueUnifiTable({ canControl }: { canControl: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);
  const [revived, setRevived] = useState<string[]>([]);

  const [fixFor, setFixFor] = useState<Row | null>(null);
  const [fixBusy, setFixBusy] = useState(false);
  const [fixResult, setFixResult] = useState<FixResult | null>(null);
  const [termFor, setTermFor] = useState<Row | null>(null);
  const [customUser, setCustomUser] = useState("");
  const [customPass, setCustomPass] = useState("");
  const [termOpen, setTermOpen] = useState(false);
  const [ignoreFor, setIgnoreFor] = useState<Row | null>(null);
  const [ignoreNote, setIgnoreNote] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/rogue-unifi");
      const d = await res.json();
      if (d.error) setError(d.error);
      else {
        setRows(d.rows);
        setRevived(d.revived ?? []);
        setError(null);
      }
    } catch {
      setError("Could not reach the portal API.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (mac: string, status: string, note = "") => {
    await fetch("/api/admin/rogue-unifi", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mac, status, note }),
    });
    void load();
  };

  const runFix = async (row: Row) => {
    setFixFor(row);
    setFixResult(null);
    setFixBusy(true);
    try {
      const res = await fetch("/api/admin/rogue-unifi/attempt-fix", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ip: row.ip }),
      });
      setFixResult(await res.json());
    } catch {
      setFixResult({ error: "Network error while probing the device." });
    } finally {
      setFixBusy(false);
    }
  };

  const visible = (rows ?? []).filter(
    (r) => showIgnored || (r.status !== "ignored" && r.status !== "ignored-until-reconnect"),
  );
  const { sorted, sort, toggle } = useTableSort(visible, SORTS);

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {revived.length > 0 && (
        <p className="rounded-md border border-sky-500/50 bg-sky-500/10 p-2 text-xs text-sky-700 dark:text-sky-400">
          {revived.length} device(s) that were ignored-until-reconnect are back online and have
          returned to this list: <span className="font-mono">{revived.join(", ")}</span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
          {busy ? "Refreshing…" : "Refresh"}
        </Button>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={showIgnored} onChange={(e) => setShowIgnored(e.target.checked)} />
          Show ignored
        </label>
        <span className="ml-auto text-xs text-muted-foreground">{visible.length} shown</span>
      </div>

      {rows && visible.length === 0 ? (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">
          No rogue UniFi hardware detected. Anything the controller identifies as its own
          hardware but hasn&apos;t adopted would appear here.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs">
              <tr>
                <th className="p-2"><SortLabel label="Status" k="status" sort={sort} onToggle={toggle} /></th>
                <th className="p-2"><SortLabel label="MAC" k="mac" sort={sort} onToggle={toggle} /></th>
                <th className="p-2"><SortLabel label="Name" k="name" sort={sort} onToggle={toggle} /></th>
                <th className="p-2"><SortLabel label="IP" k="ip" sort={sort} onToggle={toggle} /></th>
                <th className="p-2"><SortLabel label="Vendor" k="vendor" sort={sort} onToggle={toggle} /></th>
                <th className="p-2"><SortLabel label="Seen on" k="seenOn" sort={sort} onToggle={toggle} /></th>
                <th className="p-2"><SortLabel label="Why" k="why" sort={sort} onToggle={toggle} /></th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.mac} className={`border-t ${r.online ? "" : "opacity-60"}`}>
                  <td className="p-2 text-xs">
                    {!r.online && <span className="rounded bg-muted px-1.5">offline</span>}{" "}
                    {r.status === "ignored" && (
                      <span className="rounded bg-muted px-1.5 text-muted-foreground">ignored</span>
                    )}
                    {r.status === "ignored-until-reconnect" && (
                      <span className="rounded bg-muted px-1.5 text-muted-foreground">
                        ignored until reconnect
                      </span>
                    )}
                    {r.status === "marked" && (
                      <span className="rounded bg-amber-500/15 px-1.5 text-amber-700 dark:text-amber-400">
                        marked
                      </span>
                    )}
                    {r.status === "detected" && r.online && (
                      <span className="rounded bg-destructive/10 px-1.5 text-destructive">rogue</span>
                    )}
                  </td>
                  <td className="p-2 font-mono text-xs">
                    <ClientLink mac={r.mac} hint={r.hostname ?? undefined}>{r.mac}</ClientLink>
                    <RandomMacBadge mac={r.mac} className="ml-1.5" />
                  </td>
                  <td className="p-2">
                    <ClientLink mac={r.mac} hint={r.hostname ?? undefined}>{r.hostname ?? "—"}</ClientLink>
                  </td>
                  <td className="p-2 font-mono text-xs">{r.ip ?? "—"}</td>
                  <td className="p-2 text-xs">{r.vendor ?? "—"}</td>
                  <td className="p-2 text-xs">{r.uplink ?? (r.wired ? "wired" : "—")}</td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {r.reason}
                    {r.note && <div className="italic">“{r.note}”</div>}
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {canControl && r.ip && r.online && (
                        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void runFix(r)}>
                          Attempt fix
                        </Button>
                      )}
                      {canControl && r.ip && r.online && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            setTermFor(r);
                            setCustomUser("");
                            setCustomPass("");
                            setTermOpen(false);
                          }}
                        >
                          Terminal
                        </Button>
                      )}
                      {canControl && (r.status === "ignored" || r.status === "ignored-until-reconnect") && (
                        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void decide(r.mac, "clear")}>
                          Un-ignore
                        </Button>
                      )}
                      {canControl && r.status !== "ignored" && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            setIgnoreFor(r);
                            setIgnoreNote(r.note);
                          }}
                        >
                          Ignore…
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Attempt fix */}
      <Dialog open={fixFor !== null} onOpenChange={(o) => !o && setFixFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Attempt fix — {fixFor?.ip}</DialogTitle>
            <DialogDescription>
              Tries each saved SSH credential (and the UniFi factory default) against the device
              and reports its status. Nothing is changed: a factory reset wipes the device, so
              that stays your call in the terminal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            {fixBusy && <p>Probing…</p>}
            {fixResult?.ok && (
              <>
                <p className="rounded-md border border-emerald-500/50 bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-400">
                  Authenticated as <span className="font-mono">{fixResult.username}</span>.
                </p>
                {fixResult.info && (
                  <pre className="max-h-56 overflow-auto rounded-md border bg-muted/40 p-2 text-xs">{fixResult.info}</pre>
                )}
                <p className="text-xs text-muted-foreground">{fixResult.resetHint}</p>
              </>
            )}
            {fixResult && !fixResult.ok && (
              <>
                <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                  {fixResult.error}
                </p>
                {!!fixResult.attempts?.length && (
                  <ul className="text-xs text-muted-foreground">
                    {fixResult.attempts.map((a, i) => (
                      <li key={i} className="font-mono">
                        {a.ok ? "✓" : "✗"} {a.username}
                        {a.error ? ` — ${a.error}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFixFor(null)}>
              Close
            </Button>
            {fixFor && (
              <Button
                type="button"
                onClick={() => {
                  const row = fixFor;
                  setFixFor(null);
                  setTermFor(row);
                  setTermOpen(false);
                }}
              >
                Open terminal
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Terminal (saved creds, or one-off login) */}
      <Dialog
        open={termFor !== null}
        onOpenChange={(o) => {
          if (!o) {
            setTermFor(null);
            setTermOpen(false);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Terminal — {termFor?.ip}</DialogTitle>
            <DialogDescription>
              Leave the login blank to try the saved credentials in order. A username and password
              typed here are used for this session only and are never stored.
            </DialogDescription>
          </DialogHeader>
          {!termOpen ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Username (optional)</Label>
                  <Input value={customUser} onChange={(e) => setCustomUser(e.target.value)} autoComplete="off" placeholder="ubnt" />
                </div>
                <div className="space-y-1.5">
                  <Label>Password (optional)</Label>
                  <Input type="password" value={customPass} onChange={(e) => setCustomPass(e.target.value)} autoComplete="new-password" />
                </div>
              </div>
              <Button type="button" onClick={() => setTermOpen(true)}>
                Connect
              </Button>
            </div>
          ) : (
            termFor && (
              <DeviceTerminal
                mac={termFor.mac}
                openBody={{
                  ip: termFor.ip,
                  ...(customUser && customPass ? { username: customUser, password: customPass } : {}),
                }}
                onClose={() => {
                  setTermFor(null);
                  setTermOpen(false);
                }}
              />
            )
          )}
        </DialogContent>
      </Dialog>

      {/* Ignore */}
      <Dialog open={ignoreFor !== null} onOpenChange={(o) => !o && setIgnoreFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ignore {ignoreFor?.mac}</DialogTitle>
            <DialogDescription>
              Hide this device from the rogue list and the client tables. Note what it is, so the
              next person doesn&apos;t have to rediscover it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Input
                value={ignoreNote}
                onChange={(e) => setIgnoreNote(e.target.value)}
                placeholder="Neighbour's router on the shared uplink"
              />
            </div>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => setIgnoreFor(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (ignoreFor) void decide(ignoreFor.mac, "ignored-until-reconnect", ignoreNote);
                setIgnoreFor(null);
              }}
            >
              Ignore until it reconnects
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (ignoreFor) void decide(ignoreFor.mac, "ignored", ignoreNote);
                setIgnoreFor(null);
              }}
            >
              Ignore permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
