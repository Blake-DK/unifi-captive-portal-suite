/**
 * Device classification from the site naming convention token —
 * <bldg>-[F<floor>]-<type>-<id>, e.g. "12-F3-AP-4821", "7-DN-0091",
 * "1221-CN", "491-Housing-UBB-A". The tokens carry the classification intent
 * on this deployment, so they are the primary signal:
 *   AP  access point       DN  distribution (switch)   AN  access (switch)
 *   CN  core node           CAN critical access node    UBB building bridge
 * A device whose name lacks a token is "Unknown" rather than guessed — EXCEPT
 * UBB, which is also a real hardware model, so an un-tokened building bridge
 * is still recognised from its UniFi model/type as a fallback.
 */

export type NamedDeviceType = "AP" | "DN" | "AN" | "CN" | "CAN" | "UBB";

export const DEVICE_TYPE_ORDER: NamedDeviceType[] = ["AP", "DN", "AN", "CN", "CAN", "UBB"];

/** Filter value incl. "all" and "unknown". Lives here (not in the "use client"
 * DeviceTypeChips) so server components can import the array at runtime — a
 * client module's exports are proxies on the server and `.map` would throw. */
export type DeviceTypeFilterValue = "all" | NamedDeviceType | "unknown";

export const DEVICE_TYPE_FILTER_VALUES: DeviceTypeFilterValue[] = [
  "all",
  ...DEVICE_TYPE_ORDER,
  "unknown",
];

export const DEVICE_TYPE_LABELS: Record<NamedDeviceType, string> = {
  AP: "Access Point",
  DN: "Distribution (switch)",
  AN: "Access (switch)",
  CN: "Core Node",
  CAN: "Critical Access Node",
  UBB: "Building Bridge",
};

const NAME_TOKENS = new Set<NamedDeviceType>(["AP", "DN", "AN", "CN", "CAN", "UBB"]);

/** The AP/DN/AN/CN/UBB token in a device name, or null if it carries none. */
export function parseDeviceType(name?: string | null): NamedDeviceType | null {
  if (!name) return null;
  for (const raw of name.split(/[-\s]+/)) {
    // Punctuation doesn't unmake a token: "552-F3-RM345-AP???" is an AP whose
    // id is a placeholder. Digits stay, so "AP4821" (id glued on) still does
    // not match — only the bare token, however decorated, classifies.
    const t = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (NAME_TOKENS.has(t as NamedDeviceType)) return t as NamedDeviceType;
  }
  return null;
}

/** The leading building token of the naming convention (`<bldg>-…`):
 * "552-F3-RM345-AP" → "552", "1221-CN" → "1221". Null when the name is empty
 * or starts with a device-type token (no building part). Lowercased, with
 * punctuation stripped like the type tokens. */
export function parseBuildingToken(name?: string | null): string | null {
  if (!name) return null;
  const first = (name.split(/[-\s]+/)[0] ?? "").replace(/[^A-Za-z0-9]/g, "");
  if (!first) return null;
  if (NAME_TOKENS.has(first.toUpperCase() as NamedDeviceType)) return null;
  return first.toLowerCase();
}

/**
 * Canonical classifier: the name token is the source of truth. UBB also has a
 * fallback — it's a real hardware model (UniFi Building Bridge), so a building
 * bridge whose name lacks the token is still recognised from its UniFi
 * `type`/`model`. Pass those when available; name-only callers can use
 * parseDeviceType directly.
 */
export function classifyDevice(
  name?: string | null,
  hardwareType?: string | null,
  model?: string | null,
): NamedDeviceType | null {
  const token = parseDeviceType(name);
  if (token) return token;
  if (hardwareType?.toLowerCase() === "ubb" || /\bubb\b/i.test(model ?? "")) return "UBB";
  return null;
}
