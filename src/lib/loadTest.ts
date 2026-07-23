import { utils as sshUtils } from "ssh2";
import { prisma } from "./prisma";
import { decryptSecret } from "./secrets";
import { runCommand, type SshCreds } from "./deviceSsh";
import { listActiveGuests, unauthorizeGuest } from "./unifi";
import {
  buildLaunchScript,
  buildStatusScript,
  buildStopScript,
  containerName,
  FAKE_MAC_PREFIX,
  isFakeLoadMac,
  parseStatusOutput,
  type RunParams,
  type ShardStatus,
} from "./loadTestCore";

/**
 * SSH + controller side effects for the load-test control plane. Pure helpers
 * (command builders, summary parsing) live in loadTestCore.ts. Every entry
 * point here is called only from admin+settings gated, audited routes.
 */

// Re-exported so routes and the UI import one module.
export {
  aggregateSummaries,
  isFakeLoadMac,
  parseWindowSeconds,
  type RunParams,
  type RunSummary,
  type ShardStatus,
} from "./loadTestCore";

export type LoadTestHostRow = {
  id: number;
  host: string;
  port: number;
  username: string;
  privateKey: string; // encrypted
};

/** Build ssh2 creds (decrypted private key) for a host row. */
export function hostCreds(row: LoadTestHostRow): SshCreds {
  return { username: row.username, port: row.port || 22, privateKey: decryptSecret(row.privateKey) };
}

/** Generate a dedicated ed25519 keypair. `publicKey` is the authorized_keys line. */
export function generateKeyPair(): { publicKey: string; privateKey: string } {
  const gen = sshUtils as unknown as {
    generateKeyPairSync(type: string): { private: string; public: string };
  };
  const pair = gen.generateKeyPairSync("ed25519");
  return { publicKey: pair.public.trim(), privateKey: pair.private };
}

/** Reachability + docker check for a host. Never throws. */
export async function testHost(row: LoadTestHostRow): Promise<{ ok: boolean; message: string }> {
  try {
    const out = await runCommand(
      row.host,
      [hostCreds(row)],
      `docker version --format '{{.Server.Version}}' 2>&1 || echo NO_DOCKER`,
      15_000,
    );
    const t = out.trim();
    if (t.includes("NO_DOCKER") || t === "") {
      return {
        ok: false,
        message: `SSH ok, but docker is not runnable as ${row.username}. Run the "docker without sudo" command shown for this box, then reconnect.`,
      };
    }
    return { ok: true, message: `SSH ok, docker ${t.split("\n").pop()}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "SSH connection failed" };
  }
}

/** Launch one shard on one host. Returns the container name or throws. */
export async function launchOnHost(row: LoadTestHostRow, runId: number, shard: number, params: RunParams): Promise<string> {
  // Long timeout: the first run on a box pulls the k6 image before `run -d`
  // returns. Subsequent runs return in well under a second.
  const out = await runCommand(row.host, [hostCreds(row)], buildLaunchScript(runId, shard, params), 300_000);
  const id = out.trim().split("\n").pop() ?? "";
  if (!/^[0-9a-f]{12,}$/i.test(id)) {
    throw new Error(`launch failed on ${row.host}: ${out.trim().slice(-300)}`);
  }
  return containerName(runId, shard);
}

/** Read one shard's live status off its host. Never throws. */
export async function statusOnHost(row: LoadTestHostRow, runId: number, shard: number): Promise<ShardStatus> {
  try {
    const out = await runCommand(row.host, [hostCreds(row)], buildStatusScript(runId, shard), 20_000);
    const { state, exitCode, summary } = parseStatusOutput(out);
    return { shard, hostId: row.id, state, exitCode, summary };
  } catch {
    return { shard, hostId: row.id, state: "gone", exitCode: null, summary: null };
  }
}

/** Force-remove one shard's container (stop). Never throws. */
export async function stopOnHost(row: LoadTestHostRow, runId: number, shard: number): Promise<void> {
  try {
    await runCommand(row.host, [hostCreds(row)], buildStopScript(runId, shard), 20_000);
  } catch {
    /* best effort */
  }
}

export type CleanupResult = { authorizedFound: number; revoked: number; failed: number; dbRowsDeleted: number };

/**
 * Revoke every fake load-test MAC still authorized on the controller and drop
 * the matching guest rows. Uses the portal's own UniFi session — no extra
 * credentials. Idempotent: safe to run before and after a test.
 */
export async function cleanupController(): Promise<CleanupResult> {
  const guests = await listActiveGuests();
  const fakeMacs = [...new Set(guests.map((g) => g.mac.toLowerCase()).filter(isFakeLoadMac))];

  let revoked = 0;
  let failed = 0;
  const CONCURRENCY = 8;
  for (let i = 0; i < fakeMacs.length; i += CONCURRENCY) {
    const batch = fakeMacs.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map((mac) => unauthorizeGuest(mac)));
    for (const r of results) r.status === "fulfilled" ? revoked++ : failed++;
  }

  const del = await prisma.guestRegistration.deleteMany({
    where: { OR: [{ macAddress: { startsWith: FAKE_MAC_PREFIX } }, { firstName: "Load" }] },
  });

  return { authorizedFound: fakeMacs.length, revoked, failed, dbRowsDeleted: del.count };
}
