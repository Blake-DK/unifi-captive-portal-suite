"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

type EventRow = {
  id: number;
  name: string;
  startsAt: string;
  endsAt: string;
  closedAt: string | null;
  note: string | null;
  durationMin: number | null;
  downKbps: number | null;
  upKbps: number | null;
  quotaMB: number | null;
  createdBy: string;
  registrations: number;
  devices: number;
  guests: number;
};

function phase(e: EventRow): { label: string; cls: string } {
  const now = Date.now();
  if (e.closedAt) return { label: "closed", cls: "text-muted-foreground" };
  if (new Date(e.startsAt).getTime() > now) return { label: "upcoming", cls: "text-muted-foreground" };
  if (new Date(e.endsAt).getTime() < now) return { label: "ended", cls: "text-muted-foreground" };
  return { label: "● live", cls: "text-green-600 dark:text-green-400 font-medium" };
}

// Default the form to a typical evening event: now -> +6h, local time.
function defaultRange() {
  const start = new Date();
  const end = new Date(start.getTime() + 6 * 3600_000);
  const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return { start: iso(start), end: iso(end) };
}

const SORTS: SortAccessors<EventRow> = {
  event: (e) => e.name,
  window: (e) => e.startsAt,
  status: (e) => phase(e).label,
  guests: (e) => e.guests,
  devices: (e) => e.devices,
  regs: (e) => e.registrations,
};

export default function EventsPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const { sorted, sort, toggle } = useTableSort(events, SORTS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dr = defaultRange();
  const [form, setForm] = useState({
    name: "",
    startsAt: dr.start,
    endsAt: dr.end,
    note: "",
    durationMin: "",
    downKbps: "",
    upKbps: "",
    quotaMB: "",
  });

  const load = async () => {
    try {
      const res = await fetch("/api/admin/events");
      const data = await res.json();
      if (res.ok) setEvents(data.events ?? []);
      else setError(data.error ?? "Failed to load events");
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
      const res = await fetch("/api/admin/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          startsAt: new Date(form.startsAt).toISOString(),
          endsAt: new Date(form.endsAt).toISOString(),
          note: form.note,
          durationMin: form.durationMin ? Number(form.durationMin) : null,
          downKbps: form.downKbps ? Number(form.downKbps) : null,
          upKbps: form.upKbps ? Number(form.upKbps) : null,
          quotaMB: form.quotaMB ? Number(form.quotaMB) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Failed to create event");
      else {
        setForm((f) => ({ ...f, name: "", note: "" }));
        await load();
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  };

  const close = async (ev: EventRow) => {
    if (!confirm(`Close "${ev.name}" now? New registrations will stop being tagged to it.`)) return;
    const res = await fetch(`/api/admin/events/${ev.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "close" }),
    });
    if (res.ok) await load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Events</h1>
        <p className="text-sm text-muted-foreground">
          While an event is live, every new guest registration is auto-tagged to it — so a
          one-night event&apos;s guests and devices are all traceable together afterwards. An event
          can set its own access plan; precedence is voucher &gt; event &gt; location &gt; default.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create event</CardTitle>
          <CardDescription>Blank plan fields fall through to the location / site defaults.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Name</Label>
              <Input value={form.name} placeholder="Saturday Gala" required
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Starts</Label>
              <Input type="datetime-local" value={form.startsAt}
                onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Ends</Label>
              <Input type="datetime-local" value={form.endsAt}
                onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))} />
            </div>
            <div className="space-y-1.5 sm:col-span-4">
              <Label>Note</Label>
              <Input value={form.note} placeholder="optional"
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Duration (min)</Label>
              <Input type="number" min={1} placeholder="default" value={form.durationMin}
                onChange={(e) => setForm((f) => ({ ...f, durationMin: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Down (Kbps)</Label>
              <Input type="number" min={1} placeholder="default" value={form.downKbps}
                onChange={(e) => setForm((f) => ({ ...f, downKbps: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Up (Kbps)</Label>
              <Input type="number" min={1} placeholder="default" value={form.upKbps}
                onChange={(e) => setForm((f) => ({ ...f, upKbps: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Quota (MB)</Label>
              <Input type="number" min={1} placeholder="default" value={form.quotaMB}
                onChange={(e) => setForm((f) => ({ ...f, quotaMB: e.target.value }))} />
            </div>
            <div className="sm:col-span-4">
              <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create event"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent className="pt-6 text-destructive">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{events.length} event{events.length !== 1 ? "s" : ""}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Event" k="event" sort={sort} onToggle={toggle} />
                <SortableHead label="Window" k="window" sort={sort} onToggle={toggle} />
                <SortableHead label="Status" k="status" sort={sort} onToggle={toggle} />
                <SortableHead label="Guests" k="guests" sort={sort} onToggle={toggle} />
                <SortableHead label="Devices" k="devices" sort={sort} onToggle={toggle} />
                <SortableHead label="Regs" k="regs" sort={sort} onToggle={toggle} />
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((ev) => {
                const p = phase(ev);
                return (
                  <TableRow key={ev.id}>
                    <TableCell className="font-medium">
                      {ev.name}
                      {ev.note && <span className="block text-xs text-muted-foreground">{ev.note}</span>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {new Date(ev.startsAt).toLocaleString("en-GB")}
                      <br />→ {new Date(ev.endsAt).toLocaleString("en-GB")}
                    </TableCell>
                    <TableCell className={p.cls}>{p.label}</TableCell>
                    <TableCell>{ev.guests}</TableCell>
                    <TableCell>{ev.devices}</TableCell>
                    <TableCell>{ev.registrations}</TableCell>
                    <TableCell className="space-x-2 whitespace-nowrap">
                      <a href={`/api/admin/events/${ev.id}?format=csv`}>
                        <Button type="button" variant="outline" size="sm" disabled={ev.registrations === 0}>
                          CSV
                        </Button>
                      </a>
                      {!ev.closedAt && phase(ev).label === "● live" && (
                        <Button type="button" variant="outline" size="sm" onClick={() => close(ev)}>
                          Close now
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {events.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">No events yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
