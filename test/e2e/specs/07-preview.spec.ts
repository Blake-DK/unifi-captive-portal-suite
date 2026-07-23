import { test, expect } from "@playwright/test";
import { MOCK_URL } from "../helpers";

/** The admin preview walks the whole guest flow — chooser, validated form,
 * success page — without registering anything or redirecting away. */
test("preview: the walkthrough reaches the end and registers nothing", async ({ page }) => {
  const stamgrCalls = async () => {
    const res = await page.request.get(`${MOCK_URL}/__requests`);
    const rows = (await res.json()) as { path: string }[];
    return rows.filter((r) => /cmd\/stamgr$/.test(r.path)).length;
  };
  const before = await stamgrCalls();

  await page.goto("/portal?preview=1");
  await page.getByRole("button", { name: "On Base" }).click();
  await page.getByPlaceholder("John").fill("Preview");
  await page.getByPlaceholder("Smith").fill("Walkthrough");
  await page.getByPlaceholder("07700 900000").fill("5550001111");
  await page.locator('input[type="checkbox"]').first().check();
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  await expect(page).toHaveURL(/\/portal\/success\?preview=1/);
  await expect(page.getByRole("heading", { name: "You're connected!" })).toBeVisible();
  await expect(page.getByText("end of the guest flow")).toBeVisible();

  // Still there after the normal 2.5s redirect window — preview pauses it.
  await page.waitForTimeout(3500);
  await expect(page).toHaveURL(/\/portal\/success\?preview=1/);

  expect(await stamgrCalls(), "preview must never authorize").toBe(before);
});
