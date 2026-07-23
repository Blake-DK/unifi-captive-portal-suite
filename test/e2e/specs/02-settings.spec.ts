import { test, expect } from "@playwright/test";
import { loginAsAdmin, MOCK_URL } from "../helpers";

/**
 * Settings round-trip: point the UniFi connection at the mock controller
 * through the real settings page, save, and prove Test Connection goes
 * green. Every later spec depends on these saved settings.
 */
test("settings: save UniFi connection and Test Connection succeeds", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/admin/settings/unifi");

  await page.getByPlaceholder("https://10.90.0.1:8443").fill(MOCK_URL);
  await page.getByPlaceholder("portal-api").fill("portal-api");
  await page.getByPlaceholder("••••••••", { exact: true }).fill("mock-password");
  await page.getByPlaceholder("default", { exact: true }).fill("default");

  await page.getByRole("button", { name: "Save Settings" }).click();
  await expect(page.getByText("Settings saved!")).toBeVisible();

  await page.getByRole("button", { name: "Test Connection" }).click();
  await expect(page.getByText("Connected successfully")).toBeVisible({ timeout: 20_000 });
});
