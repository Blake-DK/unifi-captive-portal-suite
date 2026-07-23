import { randomBytes } from "crypto";
import type { Client, ClientChannel } from "ssh2";

/**
 * Server-side registry of open interactive SSH shells, keyed by an opaque
 * session id. Output is buffered between polls of the streaming GET; the POST
 * route writes keystrokes. Sessions idle-time-out so a closed browser tab
 * can't leak a shell forever. Module-level singleton (single container).
 */

export type SshSession = {
  id: string;
  owner: string; // admin sub — only the opener may read/write/close
  deviceName: string;
  conn: Client;
  stream: ClientChannel;
  buffer: string[]; // output chunks awaiting delivery
  notify: (() => void) | null; // wakes a waiting reader
  lastActive: number;
  closed: boolean;
  /** Total input bytes written by the admin — reported in the close audit so
   * terminal use leaves a sized trace (contents are never logged). */
  bytesWritten: number;
};

const sessions = new Map<string, SshSession>();
const IDLE_MS = 5 * 60_000;

setInterval(() => {
  const now = Date.now();
  for (const s of sessions.values()) {
    if (s.closed || now - s.lastActive > IDLE_MS) closeSession(s.id);
  }
}, 60_000).unref?.();

export function createSession(owner: string, deviceName: string, conn: Client, stream: ClientChannel): SshSession {
  const id = randomBytes(18).toString("base64url");
  const session: SshSession = {
    id,
    owner,
    deviceName,
    conn,
    stream,
    buffer: [],
    notify: null,
    lastActive: Date.now(),
    closed: false,
    bytesWritten: 0,
  };
  const push = (d: Buffer) => {
    session.buffer.push(d.toString());
    session.lastActive = Date.now();
    session.notify?.();
  };
  stream.on("data", push);
  stream.stderr.on("data", push);
  stream.on("close", () => closeSession(id));
  conn.on("error", () => closeSession(id));
  sessions.set(id, session);
  return session;
}

export function getSession(id: string, owner: string): SshSession | null {
  const s = sessions.get(id);
  if (!s || s.owner !== owner || s.closed) return null;
  s.lastActive = Date.now();
  return s;
}

export function writeSession(id: string, owner: string, data: string): boolean {
  const s = getSession(id, owner);
  if (!s) return false;
  s.bytesWritten += Buffer.byteLength(data);
  s.stream.write(data);
  return true;
}

/** Propagate the browser terminal's dimensions to the remote PTY. */
export function resizeSession(id: string, owner: string, cols: number, rows: number): boolean {
  const s = getSession(id, owner);
  if (!s) return false;
  s.stream.setWindow(rows, cols, 0, 0);
  return true;
}

export function closeSession(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  s.closed = true;
  s.notify?.();
  try {
    s.stream.end();
  } catch {}
  try {
    s.conn.end();
  } catch {}
  sessions.delete(id);
}

/** Resolve once the next output chunk(s) are available, or on close/timeout. */
export function waitForOutput(session: SshSession, timeoutMs = 25_000): Promise<string> {
  if (session.buffer.length > 0 || session.closed) {
    const out = session.buffer.join("");
    session.buffer = [];
    return Promise.resolve(out);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      session.notify = null;
      resolve("");
    }, timeoutMs);
    session.notify = () => {
      clearTimeout(timer);
      session.notify = null;
      const out = session.buffer.join("");
      session.buffer = [];
      resolve(out);
    };
  });
}
