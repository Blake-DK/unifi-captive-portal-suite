"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DeviceLabelEditor({
  mac,
  label,
  hostname,
}: {
  mac: string;
  label: string | null;
  hostname?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/devices/${encodeURIComponent(mac)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: value.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to save label");
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            className="h-8 text-sm"
            value={value}
            maxLength={40}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <Button size="sm" onClick={save} disabled={saving}>
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving}>
            Cancel
          </Button>
        </div>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        className="flex items-center gap-1.5 text-sm hover:underline"
        onClick={() => {
          setValue(label ?? "");
          setEditing(true);
        }}
      >
        {label ? <span>{label}</span> : <span className="text-muted-foreground">Unlabeled</span>}
        <Pencil className="h-3 w-3 text-muted-foreground" />
      </button>
      {hostname && (
        <span className="text-xs italic text-muted-foreground">Detected as &quot;{hostname}&quot;</span>
      )}
    </div>
  );
}
