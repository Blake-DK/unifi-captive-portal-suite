import type { Page } from "@playwright/test";

/** Must equal ADMIN_PASSWORD in docker-compose.test.yml. */
export const ADMIN_BOOTSTRAP_PASSWORD = "e2e-bootstrap-pw";

/** Satisfies the account-route username regex ^[a-z0-9_-]{3,32}$. */
export const ADMIN_USER = "e2eadmin";
/** Min 8 chars. */
export const ADMIN_PASS = "e2e-password-1";

export const GUEST = { firstName: "Evie", lastName: "Tester", phone: "5551234567" };

/** As the captive redirect delivers it / as the portal canonicalizes it. */
export const MAC_RAW = "AA:BB:CC:11:22:33";
export const MAC_CANONICAL = "aa:bb:cc:11:22:33";

/** The mock controller as the portal (and the runner) reach it. */
export const MOCK_URL = "http://mock-unifi:9080";

/** Cookie-based admin login without driving the form — the session cookie
 * lands in the page's context. Never call this with wrong credentials: the
 * per-username lockout counts failures (5 in 15 min locks the account). */
export async function loginAsAdmin(page: Page): Promise<void> {
  const res = await page.request.post("/api/admin/login", {
    data: { username: ADMIN_USER, password: ADMIN_PASS },
  });
  if (!res.ok()) throw new Error(`admin login failed: ${res.status()} ${await res.text()}`);
  // The what's-new dialog opens over the first admin page load per account
  // and its overlay swallows every click. Its seen-version lives server-side,
  // so marking it seen before any page loads keeps it away deterministically.
  await page.request.post("/api/admin/changelog").catch(() => {});
}

/** Close the what's-new dialog when a page load already opened it — the
 * path for sessions that couldn't mark it seen before navigating (spec 01's
 * UI-driven setup login). */
export async function dismissWhatsNew(page: Page): Promise<void> {
  await page.request.post("/api/admin/changelog").catch(() => {});
  const gotIt = page.getByRole("button", { name: "Got it" });
  try {
    await gotIt.waitFor({ state: "visible", timeout: 2500 });
    await gotIt.click();
  } catch {
    // Never appeared: already seen, or this page load raced ahead of it —
    // the POST above keeps it from opening on later loads either way.
  }
}

/** Abort every request that leaves the portal origin. The success page
 * auto-redirects to an external URL 2.5s after registration; this keeps the
 * browser on the page no matter how slow an assertion is. */
export async function blockOffOrigin(page: Page): Promise<void> {
  await page.route(/^https?:\/\/(?!portal:3000)/, (route) => route.abort());
}
