"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { downloadBlob } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

type Status = {
  account: string | null;
  role?: string;
  totpEnabled: boolean;
  recoveryCodesRemaining?: number;
};

type Enrollment = {
  secret: string;
  qrDataUrl: string;
};

export default function AccountPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [regenCode, setRegenCode] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/2fa");
    if (res.ok) setStatus(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const post = async (body: Record<string, string>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fetch("/api/admin/2fa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data?.error ?? "Request failed");
      return null;
    }
    return data;
  };

  const startSetup = async () => {
    const data = await post({ action: "setup" });
    if (data) {
      setEnrollment({ secret: data.secret, qrDataUrl: data.qrDataUrl });
      setCode("");
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = await post({ action: "verify", code });
    if (data) {
      setEnrollment(null);
      setCode("");
      if (Array.isArray(data.recoveryCodes)) setRecoveryCodes(data.recoveryCodes);
      setNotice("Two-factor authentication is now enabled.");
      await load();
    }
  };

  const regenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = await post({ action: "regenerate_recovery", code: regenCode });
    if (data) {
      setRegenCode("");
      if (Array.isArray(data.recoveryCodes)) setRecoveryCodes(data.recoveryCodes);
      setNotice("New recovery codes generated — your old codes no longer work.");
      await load();
    }
  };

  const copyCodes = () => {
    if (recoveryCodes) navigator.clipboard.writeText(recoveryCodes.join("\n")).catch(() => {});
  };

  const downloadCodes = () => {
    if (!recoveryCodes) return;
    const blob = new Blob(
      [`Recovery codes for ${status?.account ?? "account"}\n\n${recoveryCodes.join("\n")}\n`],
      { type: "text/plain" },
    );
    downloadBlob(blob, "recovery-codes.txt");
  };

  const disable = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = await post({ action: "disable", code });
    if (data) {
      setCode("");
      setRecoveryCodes(null);
      setNotice("Two-factor authentication has been disabled.");
      await load();
    }
  };

  if (!status) return <div>Loading…</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Account</h1>
        <p className="text-sm text-muted-foreground">Sign-in security for your admin account</p>
      </div>

      {status.account === null ? (
        <Card>
          <CardHeader>
            <CardTitle>Setup session</CardTitle>
            <CardDescription>
              You&apos;re signed in with the first-time-setup login, which has no personal
              account attached. Create your admin account under{" "}
              <Link href="/admin/settings/admins" className="underline">
                Settings → Admins
              </Link>
              , then sign in with it to manage 2FA here.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{status.account}</CardTitle>
              <CardDescription>
                Role: <strong>{status.role}</strong>
                {status.role === "monitor" ? " (read-only)" : " (full control)"}
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Two-Factor Authentication</CardTitle>
              <CardDescription>
                {status.totpEnabled
                  ? "Enabled — signing in requires a code from your authenticator app."
                  : "Add a second factor: after your password, you'll be asked for a 6-digit code from an authenticator app (Google Authenticator, Bitwarden, 1Password…)."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!status.totpEnabled && !enrollment && (
                <Button onClick={startSetup} disabled={busy}>
                  {busy ? "Generating…" : "Set up 2FA"}
                </Button>
              )}

              {!status.totpEnabled && enrollment && (
                <div className="space-y-4">
                  <div className="flex flex-col items-start gap-4 sm:flex-row">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={enrollment.qrDataUrl}
                      alt="TOTP enrollment QR code"
                      className="rounded-md border"
                      width={220}
                      height={220}
                    />
                    <div className="space-y-2 text-sm">
                      <p>1. Scan the QR code with your authenticator app.</p>
                      <p>
                        Can&apos;t scan? Enter this key manually:
                        <code className="mt-1 block rounded bg-muted px-2 py-1 font-mono text-xs tracking-wider">
                          {enrollment.secret}
                        </code>
                      </p>
                      <p>2. Enter the 6-digit code the app shows to confirm.</p>
                    </div>
                  </div>
                  <form onSubmit={verify} className="flex items-end gap-3">
                    <div className="space-y-1.5">
                      <Label>Code</Label>
                      <Input
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="123456"
                        maxLength={6}
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        className="w-32"
                        required
                      />
                    </div>
                    <Button type="submit" disabled={busy}>
                      {busy ? "Verifying…" : "Activate"}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setEnrollment(null)} disabled={busy}>
                      Cancel
                    </Button>
                  </form>
                </div>
              )}

              {status.totpEnabled && (
                <form onSubmit={disable} className="flex items-end gap-3">
                  <div className="space-y-1.5">
                    <Label>Current code</Label>
                    <Input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      className="w-32"
                      required
                    />
                  </div>
                  <Button type="submit" variant="destructive" disabled={busy}>
                    {busy ? "Disabling…" : "Disable 2FA"}
                  </Button>
                </form>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}
              {notice && <p className="text-sm text-emerald-700">{notice}</p>}
            </CardContent>
          </Card>

          {/* Freshly generated codes — shown once, never retrievable again. */}
          {recoveryCodes && (
            <Card className="border-amber-500/50">
              <CardHeader>
                <CardTitle>Save your recovery codes</CardTitle>
                <CardDescription>
                  Each code works <strong>once</strong> to sign in if you lose your authenticator.
                  Store them somewhere safe now — they won&apos;t be shown again.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="grid grid-cols-2 gap-2 rounded-md border bg-muted/40 p-3 font-mono text-sm">
                  {recoveryCodes.map((c) => (
                    <li key={c} className="tracking-wider">{c}</li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={copyCodes}>Copy</Button>
                  <Button type="button" variant="outline" size="sm" onClick={downloadCodes}>Download .txt</Button>
                  <Button type="button" size="sm" onClick={() => setRecoveryCodes(null)}>I&apos;ve saved them</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recovery-code management, once 2FA is on. */}
          {status.totpEnabled && !recoveryCodes && (
            <Card>
              <CardHeader>
                <CardTitle>Recovery codes</CardTitle>
                <CardDescription>
                  One-time backup codes for signing in when your authenticator isn&apos;t available.
                  {typeof status.recoveryCodesRemaining === "number" && (
                    <> You have <strong>{status.recoveryCodesRemaining}</strong> unused code
                    {status.recoveryCodesRemaining === 1 ? "" : "s"} left.</>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {typeof status.recoveryCodesRemaining === "number" &&
                  status.recoveryCodesRemaining <= 3 && (
                    <p className="text-sm text-amber-600 dark:text-amber-500">
                      You&apos;re running low on recovery codes — regenerate to get a fresh set.
                    </p>
                  )}
                <form onSubmit={regenerate} className="flex items-end gap-3">
                  <div className="space-y-1.5">
                    <Label>Current code</Label>
                    <Input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      maxLength={6}
                      value={regenCode}
                      onChange={(e) => setRegenCode(e.target.value)}
                      className="w-32"
                      required
                    />
                  </div>
                  <Button type="submit" variant="outline" disabled={busy}>
                    {busy ? "Generating…" : "Regenerate recovery codes"}
                  </Button>
                </form>
                <p className="text-xs text-muted-foreground">
                  Regenerating invalidates all previous codes.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
