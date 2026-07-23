import { prisma } from "./prisma";
import { invalidateSettingsRow } from "./settingsRow";
import { encryptSecret, isEncrypted } from "./secrets";

/**
 * One-time, idempotent sweep that encrypts any plaintext secrets already in the
 * database (from before encryption-at-rest existed). Runs at boot; values
 * already in `enc:` form are skipped, so it's a no-op on every boot after the
 * first. Failures are logged, never thrown — plaintext still works via the
 * transparent-decrypt passthrough, so a failed sweep can't break startup.
 */
export async function encryptExistingSecrets(): Promise<void> {
  try {
    const s = await prisma.systemSettings.findUnique({ where: { id: "config" } });
    if (s) {
      const patch: Record<string, string> = {};
      for (const f of ["unifiPassword", "smtpPassword", "cfDnsApiToken", "traefikConfigToken", "deviceSshPassword"] as const) {
        const v = s[f];
        if (v && !isEncrypted(v)) patch[f] = encryptSecret(v);
      }
      if (Object.keys(patch).length) {
        await prisma.systemSettings.update({ where: { id: "config" }, data: patch });
        invalidateSettingsRow();
      }
    }

    const creds = await prisma.deviceSshCredential.findMany();
    for (const c of creds) {
      if (c.password && !isEncrypted(c.password)) {
        await prisma.deviceSshCredential.update({ where: { id: c.id }, data: { password: encryptSecret(c.password) } });
      }
    }

    const users = await prisma.adminUser.findMany({ where: { totpSecret: { not: null } } });
    for (const u of users) {
      if (u.totpSecret && !isEncrypted(u.totpSecret)) {
        await prisma.adminUser.update({ where: { id: u.id }, data: { totpSecret: encryptSecret(u.totpSecret) } });
      }
    }
  } catch (e) {
    console.error("Secret encryption sweep failed (secrets remain readable as plaintext):", e);
  }
}
