"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { maskPhone } from "@/lib/masks";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const expired = params.get("expired") === "1";
  // Where the proxy redirected the guest from; only honor internal portal
  // paths so a crafted ?next= can't bounce a login through somewhere else.
  const rawNext = params.get("next");
  const next = rawNext && /^\/portal\/[\w/-]*$/.test(rawNext) ? rawNext : "/portal/my-devices";
  // Present when the guest arrived via the UniFi captive redirect: signing in
  // then also registers + authorizes this device (server-side, same rules as
  // the my-devices "add" flow).
  const mac = params.get("id") ?? params.get("mac") ?? "";
  const [phone, setPhone] = useState("");
  const [lastName, setLastName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setDeviceError(null);
    try {
      const res = await fetch("/api/portal/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, lastName, mac }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Login failed");
        return;
      }
      if (mac && data.deviceAdded) {
        router.push("/portal/success");
        return;
      }
      if (mac && data.deviceError) {
        // Signed in, but this device couldn't be connected — show why and let
        // them fix it (e.g. remove an old device) instead of navigating away
        // from the explanation.
        setDeviceError(data.deviceError);
        return;
      }
      router.push(next);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="w-full max-w-md shadow-xl">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Manage Your Devices</CardTitle>
        <CardDescription>Log in with the details you registered with</CardDescription>
      </CardHeader>
      <CardContent>
        {expired && (
          <div className="mb-4 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            Your link has expired. Please log in again.
          </div>
        )}
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-1.5">
            <Label>Phone Number</Label>
            <Input
              inputMode="tel"
              placeholder="07700 900000"
              value={maskPhone(phone)}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Last Name</Label>
            <Input
              placeholder="Smith"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {deviceError && (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
              <p>You&apos;re signed in, but this device couldn&apos;t be connected: {deviceError}</p>
              <button
                type="button"
                className="mt-1 underline hover:text-foreground"
                onClick={() => router.push(next)}
              >
                Manage my devices
              </button>
            </div>
          )}
          <Button type="submit" className="w-full bg-primary text-primary-foreground" disabled={submitting}>
            {submitting ? "Logging in…" : mac ? "Log in & connect this device" : "Log In"}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          New here? <a href="/portal" className="underline hover:text-foreground">Register a device</a>
        </p>
      </CardContent>
    </Card>
  );
}
