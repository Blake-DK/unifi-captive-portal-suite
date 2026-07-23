"use client";
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LogoPickerDialog } from "./LogoPickerDialog";

const MAX_LOCATIONS = 12;

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const textareaClass =
  "min-h-[90px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type LocationRow = {
  id: number;
  name: string;
  logoUrl: string | null;
  buildings: string;
  buildingFreeText: boolean;
  isHotel: boolean;
  sortOrder: number;
  retentionMode: string;
  retentionDays: number;
  // Tiered plan overrides — null = site default
  durationMin: number | null;
  downKbps: number | null;
  upKbps: number | null;
  quotaMB: number | null;
  maxDevices: number | null;
  // Guest-typed building names not on the configured list (GET only — a
  // freshly created row comes back without it).
  unknownBuildings?: string[];
};

const buildingLines = (raw: string) =>
  raw
    .split("\n")
    .map((b) => b.trim())
    .filter(Boolean);

export function LocationsEditor() {
  const [rows, setRows] = useState<LocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // The dialog edits a DRAFT copy; Save persists it into `rows`, closing
  // without saving discards — so half-edits can't linger invisibly in the
  // list the way inline editing allowed.
  const [draft, setDraft] = useState<LocationRow | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/locations");
      const data = await res.json();
      setRows(data.locations ?? []);
    } catch {
      setError("Could not load locations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openEditor = (row: LocationRow) => {
    setDraft({ ...row });
    setDraftError(null);
  };

  const patchDraft = (patch: Partial<LocationRow>) =>
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));

  // Move guest-typed names onto the draft's buildings list — Save persists.
  const adoptBuildings = (names: string[]) => {
    if (!draft) return;
    const lines = buildingLines(draft.buildings);
    const have = new Set(lines.map((b) => b.toLowerCase()));
    const added = names.filter((n) => !have.has(n.toLowerCase()));
    patchDraft({
      buildings: [...lines, ...added].join("\n"),
      unknownBuildings: (draft.unknownBuildings ?? []).filter((u) => !names.includes(u)),
    });
  };

  const saveDraft = async () => {
    if (!draft) return;
    setBusy(true);
    setDraftError(null);
    try {
      const res = await fetch(`/api/admin/locations/${draft.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          logoUrl: draft.logoUrl,
          buildings: draft.buildings,
          buildingFreeText: draft.buildingFreeText,
          isHotel: draft.isHotel,
          retentionMode: draft.retentionMode,
          retentionDays: draft.retentionDays,
          durationMin: draft.durationMin,
          downKbps: draft.downKbps,
          upKbps: draft.upKbps,
          quotaMB: draft.quotaMB,
          maxDevices: draft.maxDevices,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDraftError(data?.error ?? "Failed to save location");
        return;
      }
      setRows((prev) => prev.map((r) => (r.id === draft.id ? draft : r)));
      setDraft(null);
    } catch {
      setDraftError("Network error");
    } finally {
      setBusy(false);
    }
  };

  const deleteDraft = async () => {
    if (!draft) return;
    if (!confirm(`Delete location "${draft.name}"? Existing registrations keep its name.`)) return;
    setBusy(true);
    setDraftError(null);
    try {
      const res = await fetch(`/api/admin/locations/${draft.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDraftError(data?.error ?? "Failed to delete location");
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== draft.id));
      setDraft(null);
    } catch {
      setDraftError("Network error");
    } finally {
      setBusy(false);
    }
  };

  const addRow = async () => {
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/locations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: `Location ${rows.length + 1}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to add location");
        return;
      }
      setRows((prev) => [...prev, data.location]);
      // Straight into the editor so the new row gets its real name at once.
      openEditor(data.location);
    } catch {
      setError("Network error");
    } finally {
      setAdding(false);
    }
  };

  if (loading) return <div>Loading…</div>;

  const unknown = draft?.unknownBuildings ?? [];

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Locations</CardTitle>
          <CardDescription>
            The guest portal shows these as clickable tiles (up to {MAX_LOCATIONS}). With one
            location it is selected automatically; with none, the location step is skipped
            entirely. Click a location to edit its buildings, retention, and access plan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No locations configured — guests go straight to the registration form.
            </p>
          )}

          <div className="divide-y rounded-lg border">
            {rows.map((row) => {
              const buildings = buildingLines(row.buildings);
              const typed = row.unknownBuildings ?? [];
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => openEditor(row)}
                  className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/50"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted/50">
                    {row.logoUrl ? (
                      <img src={row.logoUrl} alt="" className="max-h-full max-w-full object-contain p-0.5" />
                    ) : (
                      <MapPin aria-hidden className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{row.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {buildings.length > 0
                        ? `${buildings.length} building${buildings.length === 1 ? "" : "s"}${row.buildingFreeText ? " · free-text entry" : ""}`
                        : row.buildingFreeText
                          ? "free-text building entry"
                          : "no building step"}
                      {row.isHotel ? " · hotel" : ""}
                    </p>
                  </div>
                  {typed.length > 0 && (
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                      {typed.length} typed by guests
                    </span>
                  )}
                  <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="button" variant="outline" onClick={addRow} disabled={adding || rows.length >= MAX_LOCATIONS}>
            {rows.length >= MAX_LOCATIONS ? `Limit reached (${MAX_LOCATIONS})` : adding ? "Adding…" : "Add Location"}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={draft !== null} onOpenChange={(o) => !busy && !o && setDraft(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          {draft && (
            <>
              <DialogHeader>
                <DialogTitle>{draft.name || "Location"}</DialogTitle>
                <DialogDescription>
                  Changes apply when you press Save — closing the window discards them.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border bg-muted/50">
                    {draft.logoUrl ? (
                      <img src={draft.logoUrl} alt={draft.name} className="max-h-full max-w-full object-contain p-1" />
                    ) : (
                      <MapPin aria-hidden className="h-8 w-8 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-48 flex-1 space-y-1.5">
                    <Label>Name</Label>
                    <Input value={draft.name} maxLength={60} onChange={(e) => patchDraft({ name: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Logo</Label>
                    <div className="flex gap-2">
                      <LogoPickerDialog onSelect={(url) => patchDraft({ logoUrl: url })} />
                      {draft.logoUrl && (
                        <Button type="button" variant="ghost" size="sm" onClick={() => patchDraft({ logoUrl: null })}>
                          Clear
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Buildings (one per line — empty to skip the building step)</Label>
                  <textarea
                    className={textareaClass}
                    value={draft.buildings}
                    onChange={(e) => patchDraft({ buildings: e.target.value })}
                    placeholder={"Block 12\nHangar 3\nBuilding 42"}
                  />
                </div>

                {unknown.length > 0 && (
                  <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                      Guests typed building names that aren&apos;t on the list — add them?
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {unknown.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => adoptBuildings([name])}
                          title="Add to the buildings list above"
                          className="rounded-full border border-amber-500/50 px-2.5 py-0.5 text-xs hover:bg-amber-500/20"
                        >
                          + {name}
                        </button>
                      ))}
                      {unknown.length > 1 && (
                        <button
                          type="button"
                          onClick={() => adoptBuildings(unknown)}
                          className="rounded-full border px-2.5 py-0.5 text-xs font-medium hover:bg-muted"
                        >
                          Add all
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Adding puts the name on the list above — press Save to keep it. Names you
                      don&apos;t add stay here as long as registrations carry them.
                    </p>
                  </div>
                )}

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.buildingFreeText}
                    onChange={(e) => patchDraft({ buildingFreeText: e.target.checked })}
                  />
                  Guests type the building themselves (required field; any lines above become
                  suggestions instead of a fixed list)
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.isHotel}
                    onChange={(e) => patchDraft({ isHotel: e.target.checked })}
                  />
                  Is a hotel accommodation (requires guests to enter a room number)
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Data Retention</Label>
                    <select
                      className={selectClass}
                      value={draft.retentionMode}
                      onChange={(e) => patchDraft({ retentionMode: e.target.value })}
                    >
                      <option value="forever">Keep forever (e.g. permanent staff)</option>
                      <option value="anonymize">Anonymize after N days (e.g. temp staff)</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Days After Expiry</Label>
                    <Input
                      type="number"
                      min={0}
                      value={draft.retentionDays}
                      onChange={(e) => patchDraft({ retentionDays: Number(e.target.value) })}
                      disabled={draft.retentionMode !== "anonymize"}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Access Plan (blank = site default)</Label>
                  <div className="grid gap-3 sm:grid-cols-5">
                    {(
                      [
                        ["durationMin", "Duration (min)"],
                        ["downKbps", "Down (Kbps)"],
                        ["upKbps", "Up (Kbps)"],
                        ["quotaMB", "Quota (MB)"],
                        ["maxDevices", "Max devices"],
                      ] as const
                    ).map(([key, label]) => (
                      <div key={key} className="space-y-1">
                        <span className="text-xs text-muted-foreground">{label}</span>
                        <Input
                          type="number"
                          min={1}
                          placeholder="default"
                          value={draft[key] ?? ""}
                          onChange={(e) =>
                            patchDraft({ [key]: e.target.value === "" ? null : Number(e.target.value) })
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Overrides the site-wide guest defaults for guests registering at this location.
                    Vouchers still take precedence over the plan.
                  </p>
                </div>

                {draftError && <p className="text-sm text-destructive">{draftError}</p>}

                <div className="flex justify-between gap-2 pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={busy}
                    onClick={deleteDraft}
                  >
                    Delete
                  </Button>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" disabled={busy} onClick={() => setDraft(null)}>
                      Cancel
                    </Button>
                    <Button type="button" disabled={busy} onClick={saveDraft}>
                      {busy ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
