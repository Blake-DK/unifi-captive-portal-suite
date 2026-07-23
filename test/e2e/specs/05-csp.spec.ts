import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../helpers";

/**
 * The CSP is nonce-locked for scripts (no 'unsafe-inline'). Prove the policy
 * is what we think it is AND that the app still runs under it: a blocked
 * bootstrap or theme script surfaces as a "Refused to execute" console
 * message, and a dead hydration would never fire the dashboard's live poll.
 */
test("csp: nonce-locked script-src, pages run with zero violations", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to execute|Refused to apply|Refused to load/i.test(m.text())) {
      violations.push(m.text());
    }
  });

  // Guest portal (carries the inline theme script + brand style block).
  const res = await page.goto("/portal?preview=1");
  const csp = res!.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("'nonce-");
  expect(csp).toContain("'strict-dynamic'");
  expect(csp, "script-src must not fall back to unsafe-inline").not.toMatch(
    /script-src[^;]*'unsafe-inline'/,
  );
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();

  // Admin dashboard: the live tile polls from client JS, so seeing that
  // request proves hydration executed under the nonce policy.
  await loginAsAdmin(page);
  const livePoll = page.waitForRequest(/\/api\/admin\/dashboard\/live/, { timeout: 20_000 });
  await page.goto("/admin");
  await livePoll;

  expect(violations, violations.join("\n")).toEqual([]);
});
