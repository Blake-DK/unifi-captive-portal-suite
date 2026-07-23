import { Client, type ClientChannel } from "ssh2";
import { prisma } from "./prisma";
import { listDevices } from "./unifi";
import { canonicalizeMac } from "./mac";
import { decryptSecret } from "./secrets";

/**
 * SSH into UniFi devices for the admin debugging tools. Credentials are the
 * controller-pushed device SSH login stored in SystemSettings; the host is
 * always resolved from the controller's device list by MAC (never taken from
 * the caller) so these can't be pointed at an arbitrary address. Device host
 * keys are not pre-known, so they're accepted on connect — this is a trusted
 * LAN management path, not the open internet.
 */

export type SshCreds = { username: string; password?: string; port: number; privateKey?: string };

/** UniFi factory default, for blank/unadopted devices. Always tried last. */
export const UBNT_DEFAULT: SshCreds = { username: "ubnt", password: "ubnt", port: 22 };

/**
 * All configured device SSH credentials, in the order they should be tried.
 * A large network may push several different device logins, so the client
 * attempts each until one authenticates. The UniFi factory default (ubnt/ubnt)
 * is always appended last so a blank/unadopted device is still reachable.
 */
export async function getSshCredentials(): Promise<SshCreds[]> {
  const rows = await prisma.deviceSshCredential.findMany({
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  let creds: SshCreds[] = rows
    .filter((r) => r.username && r.password)
    .map((r) => ({ username: r.username, password: decryptSecret(r.password), port: r.port || 22 }));

  // Legacy single credential, if the table is empty.
  if (creds.length === 0) {
    const s = await prisma.systemSettings.findUnique({ where: { id: "config" } });
    if (s?.deviceSshUsername && s.deviceSshPassword) {
      creds = [{ username: s.deviceSshUsername, password: decryptSecret(s.deviceSshPassword), port: s.deviceSshPort || 22 }];
    }
  }

  if (!creds.some((c) => c.username === UBNT_DEFAULT.username && c.password === UBNT_DEFAULT.password)) {
    creds.push(UBNT_DEFAULT);
  }
  return creds;
}

/** Resolve a MAC to the adopted device's current IP (or null if unknown/offline). */
export async function deviceHostForMac(rawMac: string): Promise<{ ip: string; name: string } | null> {
  const mac = canonicalizeMac(rawMac);
  if (!mac) return null;
  const device = (await listDevices().catch(() => [])).find((d) => d.mac.toLowerCase() === mac);
  if (!device?.ip) return null;
  return { ip: device.ip, name: device.name || mac };
}

function connectOne(host: string, creds: SshCreds): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => resolve(conn))
      .on("error", (err) => reject(err))
      .connect({
        host,
        port: creds.port,
        username: creds.username,
        // Key auth when a private key is supplied (load-test generator boxes),
        // password auth otherwise (UniFi devices).
        ...(creds.privateKey ? { privateKey: creds.privateKey } : { password: creds.password }),
        readyTimeout: 10_000,
        // Device keys aren't enrolled; trust on the management LAN.
        hostVerifier: () => true,
        algorithms: {
          // UniFi devices run older OpenSSH — allow the legacy KEX/host-key sets.
          serverHostKey: ["ssh-ed25519", "ecdsa-sha2-nistp256", "rsa-sha2-512", "rsa-sha2-256", "ssh-rsa"],
        },
      });
  });
}

/**
 * Try each credential in order until one connects; return the live connection.
 * Auth failures move on to the next credential; if all fail, the last error is
 * thrown (so the caller reports a real reason).
 */
async function connect(host: string, creds: SshCreds[]): Promise<Client> {
  if (creds.length === 0) throw new Error("No device SSH credentials configured");
  let lastErr: unknown;
  for (const c of creds) {
    try {
      return await connectOne(host, c);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("SSH connection failed");
}

/** Run one command, capture combined output, always close the connection. */
export async function runCommand(host: string, creds: SshCreds[], command: string, timeoutMs = 15_000): Promise<string> {
  const conn = await connect(host, creds);
  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Command timed out")), timeoutMs);
      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          return reject(err);
        }
        let out = "";
        stream
          .on("close", () => {
            clearTimeout(timer);
            resolve(out);
          })
          .on("data", (d: Buffer) => (out += d.toString()))
          .stderr.on("data", (d: Buffer) => (out += d.toString()));
      });
    });
  } finally {
    conn.end();
  }
}

/**
 * Run one command and capture raw stdout as bytes (stderr is captured
 * separately as text). For binary output like a tcpdump `-w -` pcap stream,
 * where decoding stdout to a string would corrupt it. The whole capture is
 * buffered in memory, so callers must bound it (packet count / duration) —
 * these are short diagnostic captures, not a firehose tap.
 */
export async function runCommandBinary(
  host: string,
  creds: SshCreds[],
  command: string,
  timeoutMs = 60_000,
): Promise<{ stdout: Buffer; stderr: string }> {
  const conn = await connect(host, creds);
  try {
    return await new Promise<{ stdout: Buffer; stderr: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Capture timed out")), timeoutMs);
      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          return reject(err);
        }
        const chunks: Buffer[] = [];
        let stderr = "";
        stream
          .on("close", () => {
            clearTimeout(timer);
            resolve({ stdout: Buffer.concat(chunks), stderr });
          })
          .on("data", (d: Buffer) => chunks.push(d))
          .stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      });
    });
  } finally {
    conn.end();
  }
}

/** Open an interactive shell; caller owns the returned channel + connection lifecycle. */
export async function openShell(
  host: string,
  creds: SshCreds[],
): Promise<{ conn: Client; stream: ClientChannel }> {
  const conn = await connect(host, creds);
  return await new Promise((resolve, reject) => {
    conn.shell({ term: "xterm-256color" }, (err, stream) => {
      if (err) {
        conn.end();
        return reject(err);
      }
      resolve({ conn, stream });
    });
  });
}

/** Read-only diagnostics: label + command, safe to run on any UniFi device. */
export const DIAGNOSTICS: { label: string; command: string }[] = [
  { label: "Uptime & load", command: "uptime" },
  { label: "Memory", command: "cat /proc/meminfo | head -n 5" },
  { label: "CPU / processes", command: "top -bn1 | head -n 15" },
  { label: "Interfaces", command: "ifconfig 2>/dev/null | grep -E '^[a-z]|RX|TX' | head -n 40" },
  { label: "Routing table", command: "ip route 2>/dev/null || route -n" },
  { label: "Association list (APs)", command: "wstalist 2>/dev/null | head -n 60 || echo 'not an AP'" },
];
