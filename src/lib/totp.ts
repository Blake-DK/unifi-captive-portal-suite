/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30s period — the parameters every
 * authenticator app and Bitwarden default to), on Web Crypto only.
 */

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIOD_S = 30;
const DIGITS = 6;

export function generateTotpSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[\s=]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const idx = B32_ALPHABET.indexOf(c);
    if (idx === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const msg = new ArrayBuffer(8);
  const view = new DataView(msg);
  // JS bit ops are 32-bit; split the counter manually
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);

  const keyBuf = secret.buffer.slice(secret.byteOffset, secret.byteOffset + secret.byteLength) as ArrayBuffer;
  const key = await crypto.subtle.importKey("raw", keyBuf, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));

  const offset = mac[mac.length - 1] & 0x0f;
  const code =
    (((mac[offset] & 0x7f) << 24) |
      ((mac[offset + 1] & 0xff) << 16) |
      ((mac[offset + 2] & 0xff) << 8) |
      (mac[offset + 3] & 0xff)) %
    10 ** DIGITS;
  return code.toString().padStart(DIGITS, "0");
}

/** Accepts the current step ±`window` steps to tolerate clock drift. */
export async function verifyTotp(secret: string, code: string, window = 1): Promise<boolean> {
  const clean = code.replace(/\D/g, "");
  if (clean.length !== DIGITS) return false;
  let secretBytes: Uint8Array;
  try {
    secretBytes = base32Decode(secret);
  } catch {
    return false;
  }
  const step = Math.floor(Date.now() / 1000 / PERIOD_S);
  for (let i = -window; i <= window; i++) {
    if ((await hotp(secretBytes, step + i)) === clean) return true;
  }
  return false;
}

export function otpauthUri(issuer: string, account: string, secret: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD_S}`;
}
