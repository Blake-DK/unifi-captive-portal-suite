"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SortableHead, useTableSort, type SortAccessors } from "@/components/admin/tableSort";

type Account = {
  id: number;
  username: string;
  role: string;
  canViewTraffic: boolean;
  totpEnabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  expiresAt: string | null;
};

/** yyyy-mm-dd for the date input, from an ISO timestamp. */
const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

const SORTS: SortAccessors<Account> = {
  username: (a) => a.username,
  role: (a) => a.role,
  traffic: (a) => a.canViewTraffic,
  totp: (a) => a.totpEnabled,
  lastLogin: (a) => a.lastLoginAt,
  disableOn: (a) => a.expiresAt,
};

export default function AdminAccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const { sorted, sort, toggle } = useTableSort(accounts, SORTS);
  const [self, setSelf] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("admin");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/accounts");
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setAccounts(data.accounts ?? []);
      setSelf(data.self ?? "");
    } else {
      setError(data?.error ?? "Failed to load accounts");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn: () => Promise<Response>) => {
    setError(null);
    const res = await fn();
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error ?? "Request failed");
      return;
    }
    await load();
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    const res = await fetch("/api/admin/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password, role }),
    });
    setCreating(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error ?? "Request failed");
      return;
    }
    setUsername("");
    setPassword("");
    if (self === "setup" && role === "admin") {
      // The setup session loses write access the moment an admin account
      // exists — don't reload into a 403; tell them what to do instead.
      setNotice(
        `Account "${username}" created. Sign out and sign back in with it — ` +
          "this setup session no longer has access.",
      );
      return;
    }
    await load();
  };

  // Delete flow: reason + the acting admin's own password, confirmed in-app.
  const [deleting, setDeleting] = useState<Account | null>(null);
  const [delReason, setDelReason] = useState("");
  const [delPassword, setDelPassword] = useState("");
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  const openDelete = (a: Account) => {
    setDeleting(a);
    setDelReason("");
    setDelPassword("");
    setDelError(null);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDelBusy(true);
    setDelError(null);
    const res = await fetch(`/api/admin/accounts/${deleting.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: delReason, password: delPassword }),
    });
    setDelBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setDelError(data?.error ?? "Delete failed");
      return;
    }
    setDeleting(null);
    await load();
  };

  const setExpiry = (a: Account, value: string) => {
    act(() =>
      fetch(`/api/admin/accounts/${a.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        // Midnight local time on the chosen date: the account stops working
        // from the start of that day.
        body: JSON.stringify({ expiresAt: value ? new Date(`${value}T00:00:00`).toISOString() : null }),
      }),
    );
  };

  const changeRole = (a: Account, newRole: string) => {
    act(() =>
      fetch(`/api/admin/accounts/${a.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      }),
    );
  };

  const toggleTraffic = (a: Account) => {
    act(() =>
      fetch(`/api/admin/accounts/${a.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ canViewTraffic: !a.canViewTraffic }),
      }),
    );
  };

  const resetPassword = (a: Account) => {
    const pw = prompt(`New password for "${a.username}" (min 8 characters):`);
    if (!pw) return;
    act(() =>
      fetch(`/api/admin/accounts/${a.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pw }),
      }),
    );
  };

  const resetTotp = (a: Account) => {
    if (!confirm(`Reset 2FA for "${a.username}"? They can re-enrol after their next login.`)) return;
    act(() =>
      fetch(`/api/admin/accounts/${a.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resetTotp: true }),
      }),
    );
  };

  if (loading) return <div>Loading…</div>;

  return (
    <div className="grid gap-6">
      {self === "setup" && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300">
          <p className="font-semibold">First-time setup</p>
          <p>
            Create your personal <strong>admin</strong> account below, then sign out and sign back
            in with it. This setup login stops working as soon as the account exists.
          </p>
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-emerald-500/50 bg-emerald-500/10 p-4 text-sm text-emerald-800">
          {notice}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Admin Accounts</CardTitle>
          <CardDescription>
            Give each person the lowest role that covers their job — the <em>Traffic data</em>{" "}
            grant is separate and off by default.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="mb-4 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-[auto_1fr]">
            <dt className="font-semibold">admin</dt>
            <dd className="text-muted-foreground">
              Full control, including settings and account management.
            </dd>
            <dt className="font-semibold">operator</dt>
            <dd className="text-muted-foreground">
              Manages guests and devices day-to-day; no settings or accounts.
            </dd>
            <dt className="font-semibold">monitor</dt>
            <dd className="text-muted-foreground">Read-only.</dd>
          </dl>
          <p className="mb-4 text-xs text-muted-foreground">
            Only while no admin account exists, a blank username plus the server&apos;s
            ADMIN_PASSWORD environment variable opens this first-time-setup page.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Username" k="username" sort={sort} onToggle={toggle} />
                <SortableHead label="Role" k="role" sort={sort} onToggle={toggle} />
                <SortableHead label="Traffic data" k="traffic" sort={sort} onToggle={toggle} />
                <SortableHead label="2FA" k="totp" sort={sort} onToggle={toggle} />
                <SortableHead label="Last login" k="lastLogin" sort={sort} onToggle={toggle} />
                <SortableHead label="Disable on" k="disableOn" sort={sort} onToggle={toggle} />
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No accounts yet — create the first admin account below
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">
                      {a.username}
                      {a.username === self && <span className="text-xs text-muted-foreground"> (you)</span>}
                    </TableCell>
                    <TableCell>
                      <select
                        value={a.role}
                        onChange={(e) => changeRole(a, e.target.value)}
                        className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                      >
                        <option value="admin">admin</option>
                        <option value="operator">operator</option>
                        <option value="monitor">monitor</option>
                      </select>
                    </TableCell>
                    <TableCell>
                      <label className="flex items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          checked={a.canViewTraffic}
                          onChange={() => toggleTraffic(a)}
                        />
                        {a.canViewTraffic ? "Allowed" : "No"}
                      </label>
                    </TableCell>
                    <TableCell className="text-xs">
                      {a.totpEnabled ? (
                        <span className="text-emerald-700">Enabled</span>
                      ) : (
                        <span className="text-muted-foreground">Off</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString("en-GB") : "Never"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="date"
                          className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                          value={toDateInput(a.expiresAt)}
                          disabled={a.username === self}
                          title={
                            a.username === self
                              ? "You can't change your own expiry date"
                              : "Blank = never disabled"
                          }
                          onChange={(e) => setExpiry(a, e.target.value)}
                        />
                        {a.expiresAt && new Date(a.expiresAt) <= new Date() && (
                          <span className="text-xs font-medium text-red-500">disabled</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-nowrap justify-end gap-1.5 whitespace-nowrap">
                        <Button size="sm" variant="outline" onClick={() => resetPassword(a)}>
                          Reset password
                        </Button>
                        {a.totpEnabled && (
                          <Button size="sm" variant="outline" onClick={() => resetTotp(a)}>
                            Reset 2FA
                          </Button>
                        )}
                        {a.username !== self && (
                          <Button size="sm" variant="destructive" onClick={() => openDelete(a)}>
                            Delete
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create Account</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid gap-4 sm:grid-cols-4 sm:items-end">
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="jsmith" required />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 8 characters"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="admin">admin — full control</option>
                <option value="operator">operator — manage guests only</option>
                <option value="monitor">monitor — read-only</option>
              </select>
            </div>
            <Button type="submit" disabled={creating}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </form>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete account &quot;{deleting?.username}&quot;</DialogTitle>
            <DialogDescription>
              This cannot be undone. State why the account is being removed (kept in the audit
              trail) and confirm with your own password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Reason for deletion</Label>
              <Input
                autoFocus
                value={delReason}
                onChange={(e) => setDelReason(e.target.value)}
                placeholder="e.g. contractor engagement ended"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Your password</Label>
              <Input
                type="password"
                autoComplete="current-password"
                value={delPassword}
                onChange={(e) => setDelPassword(e.target.value)}
              />
            </div>
            {delError && <p className="text-xs text-red-500">{delError}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={delBusy || delReason.trim().length < 3 || !delPassword}
              onClick={() => void confirmDelete()}
            >
              {delBusy ? "Deleting…" : "Delete account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
