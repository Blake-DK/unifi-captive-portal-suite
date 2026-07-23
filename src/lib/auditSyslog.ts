import { createSocket } from "node:dgram";

/**
 * SIEM forwarding for the audit trail (IronWiFi's headline compliance
 * feature): every audit event — guest registrations, logins, admin actions,
 * denials — goes out as one RFC 5424 UDP syslog line with a JSON payload.
 * Fire-and-forget by design: a dead collector must never slow or fail the
 * operation being audited. Only node: imports here, so the formatter is
 * directly unit-testable.
 */

export type SyslogEvent = {
  createdAt: Date;
  actorType: string;
  actor: string;
  action: string;
  target?: string | null;
  outcome?: string;
  ip?: string | null;
  detail?: unknown;
};

// local0.info
const PRI = 16 * 8 + 6;

export function renderSyslogLine(e: SyslogEvent, hostname = "portal"): string {
  const payload = JSON.stringify({
    actorType: e.actorType,
    actor: e.actor,
    action: e.action,
    target: e.target ?? null,
    outcome: e.outcome ?? "success",
    ip: e.ip ?? null,
    detail: e.detail ?? null,
  });
  return `<${PRI}>1 ${e.createdAt.toISOString()} ${hostname} portal-audit - - - ${payload}`;
}

export function sendSyslog(line: string, host: string, port: number): void {
  try {
    const sock = createSocket("udp4");
    const buf = Buffer.from(line);
    sock.send(buf, 0, buf.length, port, host, () => sock.close());
    sock.on("error", () => sock.close());
  } catch {
    // UDP is best-effort; failures are silent by design.
  }
}
