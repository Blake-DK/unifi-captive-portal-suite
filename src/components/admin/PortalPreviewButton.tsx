"use client";

import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Opens the guest portal in a phone-sized popup in preview mode
 * (`/portal?preview=1`) — the branded registration page exactly as a guest
 * sees it, with submission disabled, so it can be checked while configuring.
 *
 * `baseUrl` targets a different host: under a guest/admin split this admin
 * process serves no guest pages (a relative /portal 404s), so the caller
 * passes the guest-serving base URL and the preview opens through the real
 * proxy path — exactly what a guest gets. Blank/omitted = same host.
 */
export function PortalPreviewButton({ className, baseUrl }: { className?: string; baseUrl?: string }) {
  const base = (baseUrl ?? "").trim().replace(/\/+$/, "");
  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      onClick={() =>
        window.open(`${base}/portal?preview=1`, "portalPreview", "width=440,height=900")
      }
    >
      <Eye className="mr-1.5 h-4 w-4" />
      Preview portal
    </Button>
  );
}
