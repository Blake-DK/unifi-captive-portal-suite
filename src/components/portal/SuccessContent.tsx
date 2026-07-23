"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export function SuccessContent({ guestBase }: { guestBase: string | null }) {
  const params = useSearchParams();
  // Only follow web URLs — ?url= is attacker-choosable via a crafted link, and
  // assigning a javascript: URL to location.href would execute it.
  const rawTarget = params.get("url");
  const target =
    rawTarget && /^https?:\/\//i.test(rawTarget) ? rawTarget : "https://www.google.com";
  const magicToken = params.get("magic");
  const verifyPending = params.get("verify") === "1";
  const verifyMin = parseInt(params.get("min") ?? "0", 10) || 0;
  // Admin walkthrough (nothing was registered): stay on the page instead of
  // redirecting away, so the end of the flow can actually be looked at.
  const preview = params.get("preview") === "1";
  const [magicHref, setMagicHref] = useState<string | null>(null);

  useEffect(() => {
    if (preview) return;
    const t = setTimeout(
      () => {
        window.location.href = target;
      },
      // Give guests time to actually read the "confirm your email" note.
      verifyPending ? 8000 : 2500,
    );
    return () => clearTimeout(t);
  }, [target, verifyPending, preview]);

  useEffect(() => {
    if (magicToken) {
      // Self-service lives on the configured guest host when set (the magic
      // route sets the host-only session cookie there); otherwise fall back
      // to this page's own reachable origin.
      const base = guestBase || window.location.origin;
      setMagicHref(`${base}/api/portal/session/magic?token=${encodeURIComponent(magicToken)}`);
    }
  }, [magicToken, guestBase]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-emerald-50 to-emerald-100 p-6 text-center">
      {preview && (
        <div className="mb-3 rounded-md bg-amber-500 px-3 py-1.5 text-center text-xs font-semibold text-white shadow">
          PREVIEW — end of the guest flow. Nothing was registered, and the usual redirect is paused.
        </div>
      )}
      <div className="rounded-2xl border bg-card p-10 shadow-sm">
        <h1 className="text-2xl font-bold text-emerald-700">You&apos;re connected!</h1>
        <p className="mt-2 text-muted-foreground">
          You can now browse the internet. Redirecting shortly…
        </p>
        {verifyPending && (
          <div className="mt-4 max-w-sm rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 p-3 text-sm text-amber-800 dark:text-amber-300">
            <strong>Check your email.</strong> We sent you a confirmation link —
            {verifyMin > 0 ? ` you have ${verifyMin} minutes of access` : " your access is limited"} until
            you confirm your email address. Click the link in the email to unlock full access.
          </div>
        )}
        {magicHref && (
          // target="_blank" + an absolute URL give the best odds of opening
          // in the device's real default browser rather than the sandboxed
          // captive-portal webview — this is OS-controlled, not guaranteed.
          // If it does stay in the webview, the link still works correctly.
          <a
            href={magicHref}
            target="_blank"
            rel="noopener"
            className="mt-4 inline-block text-sm text-emerald-700 underline"
          >
            Manage your devices
          </a>
        )}
      </div>
    </main>
  );
}
