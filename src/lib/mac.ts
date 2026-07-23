const MAC_RE = /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$|^[0-9a-f]{12}$/i;

/**
 * Accepts a manually-typed MAC address in colon, dash, or bare-hex form,
 * case-insensitive, and returns the canonical lowercase colon-separated form
 * (matching how authorize/route.ts and the UniFi API both format MACs), or
 * null if the input isn't a valid MAC.
 */
/**
 * Lowercased MAC with the locally-administered bit (0x02 of the first octet)
 * cleared. UniFi devices derive virtual-interface MACs (bridges, BSSIDs) from
 * their physical base MAC by setting that bit — e.g. 3e:78:… answers for a
 * device whose real MAC is 3c:78:… — so comparing MACs in this form maps a
 * virtual MAC back to the physical device it belongs to.
 */
export function physicalMacForm(mac: string): string {
  const m = mac.toLowerCase();
  const first = Number.parseInt(m.slice(0, 2), 16);
  if (Number.isNaN(first)) return m;
  return (first & ~0x02).toString(16).padStart(2, "0") + m.slice(2);
}

/**
 * Whether the MAC has the locally-administered bit set — a randomised
 * (private) address a client invented, e.g. an iPhone's Private Wi-Fi
 * Address. Its OUI prefix is fabricated, so never vendor-match one.
 */
export function isLocallyAdministeredMac(mac: string): boolean {
  const first = Number.parseInt(mac.slice(0, 2), 16);
  return !Number.isNaN(first) && (first & 0x02) !== 0;
}

export function canonicalizeMac(input: string): string | null {
  const cleaned = (input ?? "").trim().toLowerCase();
  if (!MAC_RE.test(cleaned)) return null;
  const hex = cleaned.replace(/[:-]/g, "");
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g)!.join(":");
}
