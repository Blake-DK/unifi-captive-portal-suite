"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * GDPR data-subject actions for a guest: SAR export (download everything held)
 * and right-to-erasure (delete + audit pseudonymise + controller-scrub
 * reminder). Erase is destructive and full-admin-gated server-side.
 */
export function GdprActions({ phone, name }: { phone: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"export" | "erase" | null>(null);

  const onExport = () => {
    // Straight file download from the audited export endpoint.
    window.location.href = `/api/admin/users/${encodeURIComponent(phone)}/export`;
  };

  const onErase = async () => {
    if (
      !confirm(
        `Erase "${name}" (${phone}) under the right to erasure?\n\n` +
          "This blocks their devices (disconnect + refuse reconnection, marked \"GDPR data " +
          "request\"), permanently deletes all their registrations, and pseudonymises their " +
          "identifier in the audit log. It cannot be undone.",
      )
    ) {
      return;
    }
    setBusy("erase");
    const res = await fetch(`/api/admin/users/${encodeURIComponent(phone)}/erase`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      alert(data?.error ?? "Failed to erase data subject");
      return;
    }
    alert(
      `Erased: ${data.deleted} registration(s) deleted, ${data.blocked?.length ?? 0} device(s) ` +
        `blocked, ${data.auditPseudonymised} audit reference(s) pseudonymised.\n\n${data.manualScrub}`,
    );
    router.push("/admin/users");
    router.refresh();
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={onExport} disabled={busy !== null}>
        Export data (SAR)
      </Button>
      <Button variant="destructive" size="sm" onClick={onErase} disabled={busy !== null}>
        {busy === "erase" ? "Erasing…" : "Erase & forget (GDPR)"}
      </Button>
    </div>
  );
}
