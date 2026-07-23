import { isLocallyAdministeredMac } from "@/lib/mac";

/**
 * Marks a randomised (locally-administered) client MAC wherever one is
 * listed. Renders nothing for a normal hardware address, so call sites can
 * drop it next to any MAC unconditionally. No "use client" directive: pure
 * presentational, usable from server and client components alike.
 */
export function RandomMacBadge({ mac, className = "" }: { mac: string; className?: string }) {
  if (!isLocallyAdministeredMac(mac)) return null;
  return (
    <span
      title="Locally-administered (private) address the client invented — its vendor prefix is fabricated and it may differ per SSID"
      className={`whitespace-nowrap rounded bg-muted px-1.5 py-0.5 align-middle text-[10px] font-medium not-italic text-muted-foreground ${className}`}
    >
      Randomised MAC
    </span>
  );
}
