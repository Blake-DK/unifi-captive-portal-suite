"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function EditUserProfileForm({
  phone,
  initial,
}: {
  phone: string;
  initial: { firstName: string; lastName: string; email: string | null };
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [email, setEmail] = useState(initial.email ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(phone)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to save");
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="space-y-3" onSubmit={onSubmit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>First Name</Label>
          <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Last Name</Label>
          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Email</Label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {saved && !error && <p className="text-xs text-emerald-700">Saved.</p>}
      <Button type="submit" size="sm" disabled={submitting}>
        {submitting ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
