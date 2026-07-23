import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { loginAsAdmin } from "../helpers";

/**
 * WCAG 2.0/2.1 A+AA scans (axe-core) over the main guest and admin pages.
 * color-contrast is excluded for now: the palette is operator-brandable
 * (primaryColor setting), so contrast is a theming decision to make
 * deliberately, not something to silence rule-by-rule here. Everything
 * structural (names, roles, labels, landmarks) must be clean.
 */

async function scan(page: Page, where: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .disableRules(["color-contrast"])
    .analyze();
  const summary = results.violations
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) — ${v.nodes[0]?.target?.join(" ")}`)
    .join("\n");
  expect(results.violations, `${where}:\n${summary}`).toEqual([]);
}

test("wcag: guest pages scan clean", async ({ page }) => {
  await page.goto("/portal?preview=1");
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
  await scan(page, "/portal (location chooser)");

  await page.getByRole("button", { name: "On Base" }).click();
  await scan(page, "/portal (registration form)");

  await page.goto("/portal/login");
  await scan(page, "/portal/login");
});

test("wcag: admin pages scan clean", async ({ page }) => {
  await page.goto("/admin/login");
  await scan(page, "/admin/login");

  await loginAsAdmin(page);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await scan(page, "/admin (dashboard)");

  await page.goto("/admin/status");
  await expect(page.getByRole("heading", { name: "Site health" })).toBeVisible();
  await scan(page, "/admin/status");
});
