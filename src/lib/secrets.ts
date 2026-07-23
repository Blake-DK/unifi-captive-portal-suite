import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

/**
 * Symmetric encryption for secrets at rest (UniFi/SMTP/Cloudflare/SSH secrets,
 * TOTP secrets). AES-256-GCM with a key derived from ADMIN_SECRET — the app's
 * existing master secret, already required and stable — so there is no new key
 * to manage or lose. Values are stored as `enc:v1:<base64(iv|tag|ciphertext)>`.
 *
 * Transition-safe: `decryptSecret` passes plaintext through unchanged, so
 * existing plaintext values (and env-var fallbacks) keep working; they are
 * encrypted on next write and by the one-time boot sweep.
 */

const PREFIX = "enc:v1:";
let keyCache: Buffer | null = null;

function key(): Buffer {
  if (keyCache) return keyCache;
  const secret = process.env.ADMIN_SECRET;
  if (!secret || secret.length < 16) throw new Error("ADMIN_SECRET missing or too short");
  keyCache = scryptSync(secret, "portal-secretbox-v1", 32);
  return keyCache;
}

export function isEncrypted(v: unknown): v is string {
  return typeof v === "string" && v.startsWith(PREFIX);
}

/** Encrypt a secret. Blanks stay blank (preserves blank-keeps-secret semantics). */
export function encryptSecret(plain: string): string {
  if (!plain || isEncrypted(plain)) return plain;
  const iv = randomBytes(12);
  // Explicit full-length tag: without authTagLength a truncated attacker
  // tag could pass verification (semgrep gcm-no-tag-length).
  const c = createCipheriv("aes-256-gcm", key(), iv, { authTagLength: 16 });
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Decrypt a stored secret. Plaintext (non-`enc:` values) is returned as-is. */
export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return stored ?? "";
  if (!isEncrypted(stored)) return stored;
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const d = createDecipheriv("aes-256-gcm", key(), iv, { authTagLength: 16 });
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch {
    // Undecryptable (e.g. ADMIN_SECRET changed) — fail closed as "not set"
    // rather than handing ciphertext to a login/integration.
    console.error("decryptSecret: failed to decrypt a stored secret");
    return "";
  }
}
