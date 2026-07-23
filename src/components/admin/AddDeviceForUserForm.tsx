"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AddDeviceForUserForm({ phone }: { phone: string }) {
  const router = useRouter();
  const [mac, setMac] = useState("");
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(phone)}/devices`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mac, label: label.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to add device");
        return;
      }
      setMac("");
      setLabel("");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="space-y-2" onSubmit={onSubmit}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[180px] space-y-1.5">
          <Label>Device MAC Address</Label>
          <Input
            placeholder="aa:bb:cc:dd:ee:ff"
            value={mac}
            onChange={(e) => setMac(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="flex-1 min-w-[160px] space-y-1.5">
          <Label>Label (optional)</Label>
          <Input
            placeholder="Xbox — Living Room"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={40}
            autoComplete="off"
          />
        </div>
        <Button type="submit" disabled={submitting || !mac}>
          {submitting ? "Adding…" : "Add Device"}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}
