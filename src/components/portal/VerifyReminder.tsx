"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Shown instead of the registration form when a device reconnects whose
 * guest never confirmed their email: explains the situation and grants a
 * short grace window so they can reach their inbox and click the link.
 */
export function VerifyReminder({
  settings,
  mac,
  maskedEmail,
  graceMin,
}: {
  settings: any;
  mac: string;
  maskedEmail: string;
  graceMin: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState<"grace" | "resend" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  const grace = async () => {
    setBusy("grace");
    setError(null);
    try {
      const res = await fetch("/api/portal/verify/grace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mac, apMac: params.get("ap"), ssid: params.get("ssid"), site: params.get("site") }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Could not grant access");
        return;
      }
      const successParams = new URLSearchParams({ verify: "1", min: String(graceMin) });
      const target = data?.redirect || params.get("url") || "";
      if (target) successParams.set("url", target);
      if (data?.magicToken) successParams.set("magic", data.magicToken);
      router.push(`/portal/success?${successParams.toString()}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const resend = async () => {
    setBusy("resend");
    setError(null);
    try {
      const res = await fetch("/api/portal/verify/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mac }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data?.error ?? "Could not resend the email");
      else setResent(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="w-full max-w-md shadow-xl">
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
        <CardTitle className="text-2xl">Confirm your email</CardTitle>
        <CardDescription>
          You didn&apos;t confirm your email address yet. We sent a link to{" "}
          <span className="font-medium">{maskedEmail}</span> — please check your
          inbox (and spam folder).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button className="w-full" onClick={grace} disabled={busy !== null}>
          {busy === "grace" ? "Connecting…" : `Get ${graceMin} minutes to confirm it`}
        </Button>
        <Button variant="outline" className="w-full" onClick={resend} disabled={busy !== null || resent}>
          {resent ? "Email sent again — check your inbox" : busy === "resend" ? "Sending…" : "Resend the email"}
        </Button>
        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <p className="text-center text-xs text-muted-foreground">
          Wrong email or not you?{" "}
          <a href={`/portal?${new URLSearchParams({ ...Object.fromEntries(params.entries()), register: "1" }).toString()}`} className="underline hover:text-foreground">
            Register again
          </a>
        </p>
      </CardContent>
    </Card>
  );
}
