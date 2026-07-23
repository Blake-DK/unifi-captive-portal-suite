"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function DeleteUserButton({ phone, name }: { phone: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onDelete = async () => {
    if (
      !confirm(
        `Delete "${name}" (${phone})?\n\nThis kicks their devices off the network and permanently removes their profile, devices, and history.`,
      )
    ) {
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/admin/users/${encodeURIComponent(phone)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      alert(data?.error ?? "Failed to delete user");
      return;
    }
    if (data.unifiFailed?.length) {
      alert(
        `User deleted, but UniFi couldn't be told to disconnect: ${data.unifiFailed.join(", ")}. ` +
          "Their access lapses at its normal expiry.",
      );
    }
    router.push("/admin/users");
    router.refresh();
  };

  return (
    <Button variant="destructive" size="sm" onClick={onDelete} disabled={busy}>
      {busy ? "Deleting…" : "Delete User"}
    </Button>
  );
}
