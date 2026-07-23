import { prisma } from "./prisma";
import { invalidateSettingsRow } from "./settingsRow";

/**
 * One-time, idempotent migration shim for deployments upgrading from before
 * COOKIE_SECURE became a GUI-managed setting. Runs at boot; a deployment
 * that never set the env var sees a no-op write (the column stays null,
 * which every read site already treats as "not configured"). Not a
 * standing env fallback — after the DB column is non-null (whether from
 * this seed or a later GUI save), the env var is never read again.
 *
 * Preserving continuity here matters because COOKIE_SECURE=true getting
 * reset to false on upgrade would silently weaken security for a
 * deployment already running behind HTTPS.
 */
export async function seedSessionSecurityFromEnv(): Promise<void> {
  try {
    const s = await prisma.systemSettings.findUnique({ where: { id: "config" } });
    if (!s) return;

    if (s.cookieSecure === null && process.env.COOKIE_SECURE === "true") {
      await prisma.systemSettings.update({ where: { id: "config" }, data: { cookieSecure: true } });
      invalidateSettingsRow();
    }
  } catch (e) {
    console.error("Session-security env seed failed (env vars still apply via .env on restart):", e);
  }
}
