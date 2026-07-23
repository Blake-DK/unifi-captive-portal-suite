"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortableHead, useTableSort, type SortAccessors } from "@/components/admin/tableSort";

type Cred = { id: number; label: string; username: string; port: number };

const SORTS: SortAccessors<Cred> = {
  label: (c) => c.label,
  username: (c) => c.username,
  port: (c) => c.port,
};

/**
 * Manage the device SSH credentials the Network Map tools use. Multiple entries
 * are allowed — the client tries them in order until one authenticates — so a
 * network with several different device logins works. Passwords are write-only.
 */
export function DeviceSshCredentials() {
  const [creds, setCreds] = useState<Cred[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ label: "", username: "", password: "", port: 22 });

  const load = async () => {
    const res = await fetch("/api/admin/device-ssh");
    if (res.ok) setCreds((await res.json()).credentials ?? []);
    setLoading(false);
  };
  useEffect(() => {
    void load();
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/device-ssh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data?.error ?? "Failed to add credential");
      return;
    }
    setForm({ label: "", username: "", password: "", port: 22 });
    await load();
  };

  const remove = async (id: number) => {
    if (!confirm("Remove this SSH credential?")) return;
    const res = await fetch(`/api/admin/device-ssh/${id}`, { method: "DELETE" });
    if (res.ok) await load();
  };

  const { sorted, sort, toggle } = useTableSort(creds, SORTS);

  return (
    <div className="space-y-4">
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Label" k="label" sort={sort} onToggle={toggle} />
              <SortableHead label="Username" k="username" sort={sort} onToggle={toggle} />
              <SortableHead label="Port" k="port" sort={sort} onToggle={toggle} />
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((c) => (
              <TableRow key={c.id}>
                <TableCell>{c.label || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="font-mono text-xs">{c.username}</TableCell>
                <TableCell>{c.port}</TableCell>
                <TableCell className="text-right">
                  <Button type="button" variant="ghost" size="sm" onClick={() => remove(c.id)}>
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {/* Built-in UniFi factory default — always present, tried last. */}
            <TableRow className="text-muted-foreground">
              <TableCell>UniFi factory default</TableCell>
              <TableCell className="font-mono text-xs">ubnt</TableCell>
              <TableCell>22</TableCell>
              <TableCell className="text-right text-xs italic">always tried last</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}

      <form onSubmit={add} className="grid gap-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-[1fr_1fr_1fr_auto_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label className="text-xs">Label (optional)</Label>
          <Input value={form.label} placeholder="e.g. svcops"
            onChange={(e) => setForm({ ...form, label: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Username</Label>
          <Input value={form.username} autoComplete="off"
            onChange={(e) => setForm({ ...form, username: e.target.value })} required />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Password</Label>
          <Input type="password" value={form.password} autoComplete="new-password"
            onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Port</Label>
          <Input type="number" min={1} max={65535} className="w-20" value={form.port}
            onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
        </div>
        <Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add"}</Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
