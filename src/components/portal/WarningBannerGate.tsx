"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * STIG-style click-through warning banner: the guest flow stays hidden until
 * the visitor acknowledges the notice. Acknowledgement lives in
 * sessionStorage, so every new browser session sees the banner again —
 * that's the requirement's intent, not an implementation shortcut.
 */
export function WarningBannerGate({
  text,
  children,
}: {
  text: string;
  children: React.ReactNode;
}) {
  // Start unaccepted on both server and client so hydration matches, then
  // read sessionStorage after mount.
  const [accepted, setAccepted] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setAccepted(sessionStorage.getItem("warning-banner-ack") === "1");
    } catch {
      setAccepted(false);
    }
  }, []);

  const accept = () => {
    try {
      sessionStorage.setItem("warning-banner-ack", "1");
    } catch {
      // storage unavailable (rare embedded webviews) — allow through anyway
    }
    setAccepted(true);
  };

  if (accepted) return <>{children}</>;

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="rounded-lg border-2 border-amber-500 bg-card p-6 shadow-xl">
        <h1 className="mb-3 text-lg font-bold">Notice</h1>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
        <Button
          type="button"
          className="mt-5 w-full bg-primary text-primary-foreground"
          onClick={accept}
          disabled={accepted === null}
        >
          I understand and agree
        </Button>
      </div>
    </div>
  );
}
