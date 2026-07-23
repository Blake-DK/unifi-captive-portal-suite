"use client";

import { useEffect, useState } from "react";
import { formatTimeRemaining } from "@/lib/utils";

export function ExpiresCountdown({ expiresAt }: { expiresAt: string }) {
  const expires = new Date(expiresAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now()); // correct any SSR/client drift immediately on mount
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // The server's Date.now() and the client's differ by however long the page
  // took to reach the browser; when a minute boundary falls in that gap the
  // two renders disagree — expected for a clock, so suppress the warning.
  return <span suppressHydrationWarning>{formatTimeRemaining(expires, now)}</span>;
}
