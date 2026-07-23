import * as snmp from "net-snmp";
import { Semaphore } from "./semaphore.ts"; // explicit extension so snmpFallback.test.ts runs under Node's type-stripping runner

/**
 * SNMPv3 authPriv fallback reachability check. Used only when the UniFi
 * controller itself is unreachable (see snmpFallback.ts) — the controller
 * API stays the primary, richer source; this is deliberately narrow (one
 * scalar GET) so a degraded-mode sweep of a large fleet stays bounded.
 * v3 authPriv only: no v1/v2c (community-string) support, by design.
 */

const SYS_UP_TIME_OID = "1.3.6.1.2.1.1.3.0";
const PROBE_TIMEOUT_MS = 3000;
const PROBE_RETRIES = 1;
// Round-trips-per-target x fleet size adds up fast; bounds a sweep to a
// fraction of the alert-poll floor even on an all-dead fleet.
const SWEEP_CONCURRENCY = 16;

const AUTH_PROTOCOLS: Record<string, number> = {
  sha: snmp.AuthProtocols.sha,
  sha224: snmp.AuthProtocols.sha224,
  sha256: snmp.AuthProtocols.sha256,
  sha384: snmp.AuthProtocols.sha384,
  sha512: snmp.AuthProtocols.sha512,
};
const PRIV_PROTOCOLS: Record<string, number> = {
  aes: snmp.PrivProtocols.aes,
  aes256b: snmp.PrivProtocols.aes256b,
  aes256r: snmp.PrivProtocols.aes256r,
};

export type SnmpCreds = {
  user: string;
  authKey: string;
  privKey: string;
  authProtocol: string;
  privProtocol: string;
  port: number;
};

export type SnmpProbeResult = { mac: string; ip: string; reachable: boolean; error?: string };

function session(ip: string, creds: SnmpCreds) {
  const authProtocol = AUTH_PROTOCOLS[creds.authProtocol] ?? snmp.AuthProtocols.sha;
  const privProtocol = PRIV_PROTOCOLS[creds.privProtocol] ?? snmp.PrivProtocols.aes;
  return snmp.createV3Session(
    ip,
    { name: creds.user, level: snmp.SecurityLevel.authPriv, authProtocol, authKey: creds.authKey, privProtocol, privKey: creds.privKey },
    { port: creds.port, timeout: PROBE_TIMEOUT_MS, retries: PROBE_RETRIES },
  );
}

/** One target, one scalar GET (sysUpTime.0) — reachable iff it answers without error. */
export function probeTarget(target: { mac: string; ip: string }, creds: SnmpCreds): Promise<SnmpProbeResult> {
  return new Promise((resolve) => {
    let s: ReturnType<typeof snmp.createV3Session>;
    try {
      s = session(target.ip, creds);
    } catch (err) {
      resolve({ mac: target.mac, ip: target.ip, reachable: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }
    s.get([SYS_UP_TIME_OID], (err, varbinds) => {
      s.close();
      if (err) {
        resolve({ mac: target.mac, ip: target.ip, reachable: false, error: err.message });
        return;
      }
      const vb = varbinds?.[0];
      if (vb && snmp.isVarbindError(vb)) {
        resolve({ mac: target.mac, ip: target.ip, reachable: false, error: snmp.varbindError(vb) });
        return;
      }
      resolve({ mac: target.mac, ip: target.ip, reachable: true });
    });
  });
}

/** Bounded fan-out over many targets — degrades to queueing latency, never a UDP burst. */
export async function sweepTargets(
  targets: { mac: string; ip: string }[],
  creds: SnmpCreds,
): Promise<SnmpProbeResult[]> {
  const sem = new Semaphore(SWEEP_CONCURRENCY);
  return Promise.all(targets.map((t) => sem.run(() => probeTarget(t, creds))));
}
