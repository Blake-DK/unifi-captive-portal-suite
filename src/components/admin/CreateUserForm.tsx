"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import type { PortalLocation } from "@/lib/locations";

export function CreateUserForm({ locations = [] }: { locations?: PortalLocation[] }) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [mac, setMac] = useState("");
  const [label, setLabel] = useState("");
  const [locationId, setLocationId] = useState<number | null>(null);
  const [building, setBuilding] = useState("");
  const [roomNumber, setRoomNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedLocation = locations.find((l) => l.id === locationId) ?? null;
  const buildingOptions = selectedLocation?.buildings ?? [];
  const buildingFreeText = selectedLocation?.buildingFreeText ?? false;
  const buildingRequired = buildingFreeText || buildingOptions.length > 0;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          phone,
          email: email || undefined,
          mac,
          label: label.trim() || undefined,
          locationId: locationId ?? undefined,
          building: building || undefined,
          roomNumber: roomNumber.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to create user");
        return;
      }
      router.push(`/admin/users/${encodeURIComponent(data.phone)}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="max-w-xl">
      <CardContent className="pt-6">
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>First Name</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>Last Name</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Phone Number</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label>Email (optional)</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {locations.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Location (optional)</Label>
                <select
                  value={locationId ?? ""}
                  onChange={(e) => {
                    setLocationId(e.target.value ? Number(e.target.value) : null);
                    setBuilding("");
                    setRoomNumber("");
                  }}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">No location</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>
              {buildingRequired && (
                <div className="space-y-1.5">
                  <Label>Building</Label>
                  {buildingFreeText ? (
                    <>
                      <Input
                        value={building}
                        onChange={(e) => setBuilding(e.target.value)}
                        required
                        maxLength={80}
                        placeholder="e.g. Block 12"
                        list={buildingOptions.length > 0 ? "admin-building-suggestions" : undefined}
                      />
                      {buildingOptions.length > 0 && (
                        <>
                          <datalist id="admin-building-suggestions">
                            {buildingOptions.map((opt) => (
                              <option key={opt} value={opt} />
                            ))}
                          </datalist>
                          <p className="text-xs text-muted-foreground">
                            Suggestions appear as you type — a building that isn&apos;t listed can
                            be typed in full.
                          </p>
                        </>
                      )}
                    </>
                  ) : (
                    <select
                      value={building}
                      onChange={(e) => setBuilding(e.target.value)}
                      required
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="">Select building…</option>
                      {buildingOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              {buildingRequired && (
                <div className="space-y-1.5">
                  <Label>Room Number (optional)</Label>
                  <Input value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} />
                </div>
              )}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>First Device MAC Address</Label>
              <Input
                placeholder="aa:bb:cc:dd:ee:ff"
                value={mac}
                onChange={(e) => setMac(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Device Label (optional)</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Users only exist as a device registration in this system, so creating a user requires
            authorizing their first device.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create User"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
