import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { audit } from "@/lib/audit";
import { deviceHostForMac, getSshCredentials, runCommand, runCommandBinary } from "@/lib/deviceSsh";
import { parseTcpdumpInterfaces } from "@/lib/pcapIfaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SECONDS = 120;
const MAX_PACKETS = 20_000;

// tcpdump interface names on UniFi switches/APs: alnum plus . _ - (e.g. switch0,
// br0, eth0, sw0.1). A strict allowlist is what keeps the interface — which is
// interpolated into the remote command — from being an injection vector.
const IFACE_RE = /^[a-zA-Z0-9._-]{1,20}$/;

// BPF is its own little language; rather than parse it, restrict the capture
// filter to the character set real BPF expressions use. No shell
// metacharacters (;|&$`><\\ quotes newlines) can survive this, and the whole
// thing is still passed as a single quoted argv to tcpdump.
const FILTER_RE = /^[a-zA-Z0-9 .:/()\[\]-]{0,200}$/;

/**
 * What can this device capture on? `tcpdump -D` asked over SSH — the same
 * binary the capture uses, so the list is exactly what a capture can open
 * (and a missing tcpdump surfaces here, before anyone waits on a capture).
 * Feeds the dialog's port/interface picker.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ mac: string }> }) {
  const { error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const creds = await getSshCredentials();
  if (creds.length === 0) {
    return NextResponse.json(
      { error: "Set device SSH credentials in Settings → Monitoring first" },
      { status: 400 },
    );
  }

  const { mac } = await ctx.params;
  const host = await deviceHostForMac(decodeURIComponent(mac));
  if (!host) return NextResponse.json({ error: "Unknown or offline device" }, { status: 404 });

  try {
    // runCommand merges stderr, so a "tcpdump: not found" lands in `out`.
    const out = await runCommand(host.ip, creds, "tcpdump -D", 15_000);
    const ifaces = parseTcpdumpInterfaces(out);
    if (ifaces.length === 0) {
      const hint = /tcpdump[^\n]*not found|not found[^\n]*tcpdump/i.test(out)
        ? "tcpdump is not available on this device"
        : "Could not list capture interfaces";
      return NextResponse.json({ error: hint }, { status: 502 });
    }
    return NextResponse.json({ ifaces });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not list capture interfaces" },
      { status: 502 },
    );
  }
}

/**
 * Short packet capture on a device, over SSH. Full-admin only and audited: the
 * host is resolved from the controller device list by MAC (never the caller),
 * duration/packet count are hard-capped, and the interface + BPF filter are
 * validated against strict allowlists before being placed in the remote
 * command. Returns the raw pcap as a file download.
 *
 * NOTE: a switch only sees a client port's traffic if that port is mirrored (or
 * the capture targets the switch's own uplink/CPU). This runs tcpdump where you
 * point it — arranging a mirror session is out of scope; the AP/gateway path
 * (br0 / switch0) is where most useful captures happen.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ mac: string }> }) {
  const { session, error } = await requireAdmin(req, { settings: true });
  if (error) return error;

  const creds = await getSshCredentials();
  if (creds.length === 0) {
    return NextResponse.json(
      { error: "Set device SSH credentials in Settings → Monitoring first" },
      { status: 400 },
    );
  }

  const { mac } = await ctx.params;
  const host = await deviceHostForMac(decodeURIComponent(mac));
  if (!host) return NextResponse.json({ error: "Unknown or offline device" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const iface = typeof body.iface === "string" ? body.iface.trim() : "";
  const filter = typeof body.filter === "string" ? body.filter.trim() : "";
  const seconds = Math.min(Math.max(Number(body.seconds) || 15, 1), MAX_SECONDS);
  const packets = Math.min(Math.max(Number(body.packets) || 2000, 1), MAX_PACKETS);

  if (!IFACE_RE.test(iface)) {
    return NextResponse.json({ error: "Invalid interface name" }, { status: 400 });
  }
  if (!FILTER_RE.test(filter)) {
    return NextResponse.json(
      { error: "Capture filter has disallowed characters (BPF syntax only)" },
      { status: 400 },
    );
  }

  // -w - : pcap to stdout · -U unbuffered · -c count · -s0 full frames.
  // Wall-clock is bounded by a background sleep-and-kill watchdog, NOT the
  // timeout(1) binary: UniFi APs/switches ship old BusyBox where the
  // positional `timeout N cmd` form errors out instantly ("invalid number
  // 'tcpdump'") and some builds lack the applet entirely — which made every
  // capture on those devices return zero bytes. The watchdog is plain POSIX
  // sh (BusyBox ash and bash alike); -U keeps the stream flushed so a killed
  // tcpdump still leaves a valid file, and the watchdog itself is killed when
  // -c ends the capture early so the SSH channel closes without the full wait.
  // The BPF filter is a single-quoted final argument; the regex above already
  // guarantees it contains no single quote to break out of.
  // The watchdog's streams are detached so a not-yet-reaped sleep can never
  // hold the channel's stdout open after -c ends the capture early.
  const capture = `tcpdump -i ${iface} -w - -U -s 0 -c ${packets}${filter ? ` '${filter}'` : ""}`;
  const cmd = `${capture} & pid=$!; (sleep ${seconds}; kill $pid 2>/dev/null) >/dev/null 2>&1 & w=$!; wait $pid; kill $w 2>/dev/null`;

  audit(req, {
    actorType: "admin",
    actor: session.sub,
    action: "device.pcap",
    target: host.name,
    detail: { ip: host.ip, iface, filter: filter || null, seconds, packets },
  });

  try {
    // timeout(1) exits 124 when it fires, which surfaces as a non-zero close;
    // runCommandBinary resolves on close regardless, so we still get the bytes.
    const { stdout, stderr } = await runCommandBinary(host.ip, creds, cmd, (seconds + 15) * 1000);
    // tcpdump `-w -` emits a 24-byte pcap global header before any packet, so a
    // capture that matched nothing still comes back as exactly that header —
    // treat "header only or less" as an empty capture, not a download.
    const PCAP_GLOBAL_HEADER = 24;
    if (stdout.length <= PCAP_GLOBAL_HEADER) {
      // Only blame a missing tcpdump when stderr actually says so — a generic
      // "not found" match also fired on unrelated shell errors and pointed
      // operators at the wrong problem.
      const hint = /tcpdump[^\n]*not found|not found[^\n]*tcpdump/i.test(stderr)
        ? "tcpdump is not available on this device"
        : stdout.length === PCAP_GLOBAL_HEADER
          ? "No packets matched — 0 captured"
          : stderr.trim() || "No packets captured";
      return NextResponse.json({ error: hint }, { status: 502 });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `${host.name.replace(/[^a-zA-Z0-9._-]/g, "_")}_${iface}_${stamp}.pcap`;
    return new NextResponse(new Uint8Array(stdout), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.tcpdump.pcap",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(stdout.length),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Capture failed" },
      { status: 502 },
    );
  }
}
