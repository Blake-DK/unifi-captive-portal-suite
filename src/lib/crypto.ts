/**
 * Generic HMAC-SHA256 signing/verification primitives shared by admin and
 * guest session auth. Uses Web Crypto API (globalThis.crypto.subtle) for
 * Edge Runtime compatibility.
 */

export function enc(s: string): ArrayBuffer {
  const u8 = new TextEncoder().encode(s);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

export function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBuf(hex: string): Uint8Array<ArrayBuffer> {
  const ab = new ArrayBuffer(hex.length / 2);
  const bytes = new Uint8Array(ab);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function hmacSignHex(secret: string, data: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc(data));
  return bufToHex(sig);
}

export async function hmacVerify(secret: string, data: string, sigHex: string): Promise<boolean> {
  try {
    const key = await importHmacKey(secret);
    return await crypto.subtle.verify("HMAC", key, hexToBuf(sigHex), enc(data));
  } catch {
    return false;
  }
}
