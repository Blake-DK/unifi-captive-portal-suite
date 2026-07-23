"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downloadBlob } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortableHead, useTableSort, type SortAccessors } from "@/components/admin/tableSort";

type Voucher = {
  id: number;
  code: string;
  note: string | null;
  durationMin: number;
  downKbps: number | null;
  upKbps: number | null;
  quotaMB: number | null;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  createdBy: string;
  createdAt: string;
  revokedAt: string | null;
};

const fmtCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;

const fmtDuration = (min: number) =>
  min % 1440 === 0 ? `${min / 1440} d` : min % 60 === 0 ? `${min / 60} h` : `${min} min`;

function status(v: Voucher): { label: string; cls: string } {
  if (v.revokedAt) return { label: "revoked", cls: "text-muted-foreground line-through" };
  if (v.expiresAt && new Date(v.expiresAt).getTime() <= Date.now())
    return { label: "expired", cls: "text-muted-foreground" };
  if (v.maxUses > 0 && v.usedCount >= v.maxUses)
    return { label: "used", cls: "text-muted-foreground" };
  if (v.usedCount > 0) return { label: `${v.usedCount} used`, cls: "text-amber-600 dark:text-amber-400" };
  return { label: "unused", cls: "text-green-600 dark:text-green-400" };
}

const SORTS: SortAccessors<Voucher> = {
  code: (v) => v.code,
  note: (v) => v.note ?? "",
  duration: (v) => v.durationMin,
  limits: (v) => (v.downKbps ?? 0) + (v.upKbps ?? 0) + (v.quotaMB ?? 0),
  uses: (v) => v.usedCount,
  until: (v) => v.expiresAt,
  status: (v) => status(v).label,
  created: (v) => v.createdAt,
};

export default function VouchersPage() {
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const { sorted, sort, toggle } = useTableSort(vouchers, SORTS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justCreated, setJustCreated] = useState<Voucher[]>([]);
  const [form, setForm] = useState({
    count: "10",
    durationHours: "24",
    maxUses: "1",
    note: "",
    downKbps: "",
    upKbps: "",
    quotaMB: "",
    expiresAt: "",
  });

  const load = async () => {
    try {
      const res = await fetch("/api/admin/vouchers");
      const data = await res.json();
      if (res.ok) setVouchers(data.vouchers ?? []);
      else setError(data.error ?? "Failed to load vouchers");
    } catch {
      setError("Network error");
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/vouchers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          count: Number(form.count),
          durationMin: Math.round(Number(form.durationHours) * 60),
          maxUses: Number(form.maxUses),
          note: form.note,
          downKbps: form.downKbps ? Number(form.downKbps) : null,
          upKbps: form.upKbps ? Number(form.upKbps) : null,
          quotaMB: form.quotaMB ? Number(form.quotaMB) : null,
          expiresAt: form.expiresAt || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create vouchers");
      } else {
        setJustCreated(data.vouchers ?? []);
        await load();
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (v: Voucher) => {
    if (!confirm(`Revoke voucher ${fmtCode(v.code)}? It can no longer be redeemed.`)) return;
    const res = await fetch(`/api/admin/vouchers/${v.id}`, { method: "DELETE" });
    if (res.ok) await load();
  };

  const exportCsv = () => {
    const rows = [
      ["code", "note", "duration_min", "max_uses", "used", "expires_at", "status", "created_by", "created_at"],
      ...vouchers.map((v) => [
        fmtCode(v.code),
        v.note ?? "",
        String(v.durationMin),
        String(v.maxUses),
        String(v.usedCount),
        v.expiresAt ?? "",
        status(v).label,
        v.createdBy,
        v.createdAt,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    downloadBlob(
      new Blob([csv], { type: "text/csv" }),
      `vouchers-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Vouchers</h1>
        <p className="text-sm text-muted-foreground">
          Pre-generated codes guests can enter on the registration form. A voucher sets its own
          duration/bandwidth/quota and stands in for email verification.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create vouchers</CardTitle>
          <CardDescription>
            Blank bandwidth/quota fields fall back to the site-wide guest defaults.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label>How many</Label>
              <Input type="number" min={1} max={200} value={form.count}
                onChange={(e) => setForm((f) => ({ ...f, count: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Duration (hours)</Label>
              <Input type="number" min={0.5} step={0.5} value={form.durationHours}
                onChange={(e) => setForm((f) => ({ ...f, durationHours: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Uses per code (0 = unlimited)</Label>
              <Input type="number" min={0} value={form.maxUses}
                onChange={(e) => setForm((f) => ({ ...f, maxUses: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Note / batch label</Label>
              <Input value={form.note} placeholder="Conference June"
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Download limit (Kbps)</Label>
              <Input type="number" min={0} value={form.downKbps} placeholder="site default"
                onChange={(e) => setForm((f) => ({ ...f, downKbps: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Upload limit (Kbps)</Label>
              <Input type="number" min={0} value={form.upKbps} placeholder="site default"
                onChange={(e) => setForm((f) => ({ ...f, upKbps: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Data quota (MB)</Label>
              <Input type="number" min={0} value={form.quotaMB} placeholder="site default"
                onChange={(e) => setForm((f) => ({ ...f, quotaMB: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Redeemable until</Label>
              <Input type="datetime-local" value={form.expiresAt}
                onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} />
            </div>
            <div className="sm:col-span-4">
              <Button type="submit" disabled={busy}>
                {busy ? "Creating…" : "Create"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent className="pt-6 text-destructive">{error}</CardContent>
        </Card>
      )}

      {justCreated.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-green-700 dark:text-green-400">
              {justCreated.length} voucher{justCreated.length !== 1 ? "s" : ""} created
            </CardTitle>
            <CardDescription>Copy or print these now — they are also in the list below.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2 font-mono text-sm">
              {justCreated.map((v) => (
                <span key={v.id} className="rounded border bg-muted px-2 py-1">
                  {fmtCode(v.code)}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            {vouchers.length} voucher{vouchers.length !== 1 ? "s" : ""}
          </CardTitle>
          <Button type="button" variant="outline" onClick={exportCsv} disabled={vouchers.length === 0}>
            Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Code" k="code" sort={sort} onToggle={toggle} />
                <SortableHead label="Note" k="note" sort={sort} onToggle={toggle} />
                <SortableHead label="Duration" k="duration" sort={sort} onToggle={toggle} />
                <SortableHead label="Limits" k="limits" sort={sort} onToggle={toggle} />
                <SortableHead label="Uses" k="uses" sort={sort} onToggle={toggle} />
                <SortableHead label="Redeemable until" k="until" sort={sort} onToggle={toggle} />
                <SortableHead label="Status" k="status" sort={sort} onToggle={toggle} />
                <SortableHead label="Created" k="created" sort={sort} onToggle={toggle} />
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((v) => {
                const st = status(v);
                return (
                  <TableRow key={v.id}>
                    <TableCell className="font-mono">{fmtCode(v.code)}</TableCell>
                    <TableCell>{v.note ?? "-"}</TableCell>
                    <TableCell>{fmtDuration(v.durationMin)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {[
                        v.downKbps ? `↓${v.downKbps}` : null,
                        v.upKbps ? `↑${v.upKbps}` : null,
                        v.quotaMB ? `${v.quotaMB} MB` : null,
                      ]
                        .filter(Boolean)
                        .join(" ") || "defaults"}
                    </TableCell>
                    <TableCell>
                      {v.usedCount}/{v.maxUses === 0 ? "∞" : v.maxUses}
                    </TableCell>
                    <TableCell className="text-xs">
                      {v.expiresAt ? new Date(v.expiresAt).toLocaleString("en-GB") : "-"}
                    </TableCell>
                    <TableCell className={st.cls}>{st.label}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(v.createdAt).toLocaleDateString("en-GB")} by {v.createdBy}
                    </TableCell>
                    <TableCell>
                      {!v.revokedAt && (
                        <Button type="button" variant="outline" size="sm" onClick={() => revoke(v)}>
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {vouchers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    No vouchers yet
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
