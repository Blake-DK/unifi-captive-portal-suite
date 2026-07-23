/**
 * Parse `tcpdump -D` output into the capture-interface picker's options.
 * Lines look like `1.eth0 [Up, Running]`, `2.switch0 (VLAN bridge) [Up]`, or
 * bare `3.ath0` on old builds; anything that isn't a numbered entry (banners,
 * "not found" shell errors) is skipped. Pseudo-devices that never make sense
 * for a device capture (loopback, netfilter taps, USB/bluetooth monitors)
 * are dropped; `any` is kept — capturing every port at once is often exactly
 * what an operator wants.
 */
export type PcapIface = { name: string; note: string | null };

const EXCLUDE_EXACT = new Set(["lo", "nflog", "nfqueue"]);
const EXCLUDE_PREFIX = ["usbmon", "bluetooth", "dbus"];

export function parseTcpdumpInterfaces(out: string): PcapIface[] {
  const result: PcapIface[] = [];
  for (const raw of out.split("\n")) {
    const m = /^\s*\d+\.(\S+?)(?:\s+\(([^)]*)\))?(?:\s+\[([^\]]*)\])?\s*$/.exec(raw.trim());
    if (!m) continue;
    const name = m[1];
    if (EXCLUDE_EXACT.has(name) || EXCLUDE_PREFIX.some((p) => name.startsWith(p))) continue;
    // Prefer the state flags ([Up, Running]) over a description — that is
    // what tells the operator which port is live.
    result.push({ name, note: m[3] ?? m[2] ?? null });
  }
  return result;
}
