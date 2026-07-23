"use client";
import { useState } from "react";

/** "Confirm your email" nudge on the guest device list, with resend. */
export function VerifyBanner({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const resend = async () => {
    setState("sending");
    try {
      const res = await fetch("/api/portal/verify/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      setState(res.ok ? "sent" : "error");
    } catch {
      setState("error");
    }
  };

  return (
    <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 p-3 text-sm text-amber-800 dark:text-amber-300">
      <strong>Confirm your email.</strong> We sent a link to{" "}
      <span className="font-medium">{email}</span> — your access stays limited until
      you click it.{" "}
      {state === "sent" ? (
        <span>Email sent again — check your inbox.</span>
      ) : (
        <button
          type="button"
          onClick={resend}
          disabled={state === "sending"}
          className="underline hover:text-amber-900"
        >
          {state === "sending" ? "Sending…" : "Resend the email"}
        </button>
      )}
      {state === "error" && <span> Could not resend — try again in a few minutes.</span>}
    </div>
  );
}
