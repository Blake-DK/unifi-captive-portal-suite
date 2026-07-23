import { prisma } from "./prisma";
import { hashPassword, verifyPassword } from "./passwords";

/**
 * One-time 2FA recovery codes. Generated as a set when 2FA is enabled (and on
 * demand), shown to the admin exactly once, stored hashed like passwords, and
 * consumed single-use at login when the authenticator is unavailable.
 */

// Unambiguous alphabet (no 0/1/i/l/o) — codes are read off paper/a screenshot.
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const CODE_LEN = 10; // ~49 bits of entropy per code
export const RECOVERY_CODE_COUNT = 10;

/** Canonical comparison form: lower-case, alphanumerics only (dashes/spaces ignored). */
export function normalizeRecoveryCode(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Display form, e.g. "a3kf9-2mztq". */
function formatCode(raw: string): string {
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

function randomCode(): string {
  const bytes = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/**
 * Replace the user's recovery codes with a fresh set. Returns the plaintext
 * codes (display form) to show once — they are never retrievable afterwards.
 */
export async function regenerateRecoveryCodes(userId: number): Promise<string[]> {
  const plain = Array.from({ length: RECOVERY_CODE_COUNT }, randomCode);
  const rows = await Promise.all(
    plain.map(async (c) => ({ userId, codeHash: await hashPassword(c) })),
  );
  await prisma.$transaction([
    prisma.totpRecoveryCode.deleteMany({ where: { userId } }),
    prisma.totpRecoveryCode.createMany({ data: rows }),
  ]);
  return plain.map(formatCode);
}

export function countUnusedRecoveryCodes(userId: number): Promise<number> {
  return prisma.totpRecoveryCode.count({ where: { userId, usedAt: null } });
}

export async function clearRecoveryCodes(userId: number): Promise<void> {
  await prisma.totpRecoveryCode.deleteMany({ where: { userId } });
}

/**
 * Try to consume a recovery code for the user. Returns true (and marks the code
 * used) on a match against an unused code, false otherwise.
 */
export async function consumeRecoveryCode(userId: number, input: string): Promise<boolean> {
  const candidate = normalizeRecoveryCode(input);
  if (candidate.length !== CODE_LEN) return false;
  const codes = await prisma.totpRecoveryCode.findMany({ where: { userId, usedAt: null } });
  for (const row of codes) {
    if (await verifyPassword(candidate, row.codeHash)) {
      // Atomic single-use: only the first consumer wins.
      const { count } = await prisma.totpRecoveryCode.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      return count === 1;
    }
  }
  return false;
}
