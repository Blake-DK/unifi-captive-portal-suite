import { test, expect } from "@playwright/test";
import { GUEST, MAC_CANONICAL } from "../helpers";

/**
 * Returning guest: phone + last name signs into self-service and the device
 * registered in spec 03 shows on my-devices. The live-status columns degrade
 * gracefully against the mock's empty controller data; the device row itself
 * comes from the portal's own database.
 */
test("self-service: guest logs in and sees the registered device", async ({ page }) => {
  await page.goto("/portal/login");

  await page.getByPlaceholder("07700 900000").fill(GUEST.phone);
  await page.getByPlaceholder("Smith").fill(GUEST.lastName);
  await page.getByRole("button", { name: "Log In", exact: true }).click();

  await expect(page).toHaveURL(/\/portal\/my-devices/);
  const cookies = await page.context().cookies();
  expect(cookies.some((c) => c.name === "guest_session")).toBe(true);

  await expect(page.getByRole("heading", { name: "Your Devices" })).toBeVisible();
  // The device renders twice (mobile card + desktop table) with one copy
  // CSS-hidden per viewport — assert on whichever is actually shown.
  await expect(page.getByText(MAC_CANONICAL).filter({ visible: true }).first()).toBeVisible();
});
