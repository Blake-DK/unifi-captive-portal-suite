"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function RemoveDeviceButton({ mac }: { mac: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    if (!confirm(`Remove device ${mac}?`)) return;
    setError(null);
    const res = await fetch(`/api/portal/devices/${encodeURIComponent(mac)}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j?.error ?? "Failed");
      return;
    }
    startTransition(() => router.refresh());
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="destructive" onClick={onClick} disabled={pending}>
        Remove
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
