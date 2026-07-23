"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export function LoginForm({ allowSetup }: { allowSetup: boolean }) {
  const next = useSearchParams().get("next") ?? "/admin";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password, code }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      if (data?.needCode) {
        setNeedCode(true);
        // Not a failure the first time around — the code field is just appearing.
        if (!code) return;
      }
      setError(data?.error ?? "Login failed");
      return;
    }
    window.location.href = next;
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm shadow-xl">
        <CardHeader className="text-center">
          <CardTitle>Admin Panel</CardTitle>
          <CardDescription>Restricted access</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label htmlFor="admin-username">Username</Label>
              <Input
                id="admin-username"
                autoFocus
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={allowSetup ? "Username (blank only for first-time setup)" : "Username"}
                required={!allowSetup}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-password">Password</Label>
              <Input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {needCode && (
              <div className="space-y-1.5">
                <Label htmlFor="admin-2fa">2FA Code</Label>
                <Input
                  id="admin-2fa"
                  autoComplete="one-time-code"
                  placeholder="123456 or recovery code"
                  maxLength={21}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Enter the 6-digit code from your authenticator app, or one of your recovery codes
                  if you can&apos;t access it.
                </p>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full bg-primary text-primary-foreground" disabled={loading}>
              {loading ? "Signing in…" : "Sign In"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
