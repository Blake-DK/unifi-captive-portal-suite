"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";

const KEY = "portal.retentionNudge.dismissed";

/**
 * First-run reminder shown until a finite data-retention period is set
 * (defaults are "keep forever"). Rendered only when retention is still
 * unset (the dashboard computes that server-side); dismissible per browser.
 */
export function RetentionNudge() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(window.localStorage.getItem(KEY) !== "1");
    } catch {
      setShow(true);
    }
  }, []);
  if (!show) return null;

  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
      <div className="space-y-0.5">
        <p className="font-medium text-amber-900 dark:text-amber-200">No data-retention period set</p>
        <p className="text-amber-800 dark:text-amber-300">
          Guest registrations are kept <strong>forever</strong>. For GDPR data-minimisation, set a
          retention / anonymisation period in{" "}
          <Link href="/admin/settings/locations" className="underline">
            Settings → Locations
          </Link>
          .
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          try {
            window.localStorage.setItem(KEY, "1");
          } catch {
            /* ignore */
          }
          setShow(false);
        }}
        aria-label="Dismiss"
        className="shrink-0 text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
