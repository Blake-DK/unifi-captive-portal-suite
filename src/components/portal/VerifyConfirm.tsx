"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Landing page for the emailed link: one explicit click confirms the address
 * (the token in the URL is the proof of mailbox access), upgrades the guest's
 * devices to full duration, and signs them into self-service.
 */
export function VerifyConfirm({
  settings,
  token,
  email,
}: {
  settings: any;
  token: string;
  email: string;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/verify/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Could not confirm your email");
        return;
      }
      setDone(true);
      setTimeout(() => {
        window.location.href = "/portal/my-devices?verified=1";
      }, 1500);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="shadow-xl">
      <CardHeader className="text-center">
        {settings?.logoUrl && (
          <div className="mb-4 flex justify-center">
            <img
              src={settings.logoUrl}
              alt={settings.brandName || "Logo"}
              className="max-h-16 object-contain"
              referrerPolicy="no-referrer"
            />
          </div>
        )}
        <CardTitle className="text-2xl">
          {done ? "Email confirmed!" : "Confirm your email"}
        </CardTitle>
        <CardDescription>
          {done ? (
            <>Your access has been upgraded. Taking you to your devices…</>
          ) : (
            <>
              Click below to confirm <span className="font-medium">{email}</span> and
              unlock your full WiFi access.
            </>
          )}
        </CardDescription>
      </CardHeader>
      {!done && (
        <CardContent className="space-y-3">
          <Button className="w-full" onClick={confirm} disabled={busy}>
            {busy ? "Confirming…" : "Confirm email address"}
          </Button>
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
