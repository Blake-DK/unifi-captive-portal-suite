import { test, expect } from "@playwright/test";
import { blockOffOrigin, GUEST, MAC_RAW, MAC_CANONICAL, MOCK_URL } from "../helpers";

type RecordedRequest = {
  method: string;
  path: string;
  body: { cmd?: string; mac?: string } | string;
};

/**
 * The flow the product exists for: a captive-redirected guest registers and
 * the portal authorizes the MAC on the controller. The registration API
 * deletes the row and returns 502 if the authorize call fails, so reaching
 * the success page IS the proof the controller call happened — the mock's
 * request log then pins down exactly what was sent.
 */
test("guest registration: captive entry to success, authorize hits the controller", async ({
  page,
}) => {
  // The success page auto-redirects off-origin 2.5s after landing; abort
  // everything that leaves the portal so the page stays put.
  await blockOffOrigin(page);

  // The controller's captive redirect carries the client MAC in ?id=.
  await page.goto(`/guest/s/default/?id=${encodeURIComponent(MAC_RAW)}`);
  await expect(page).toHaveURL(/\/portal\?/);

  // The migration chain seeds two locations ("On Base"/"Deployed"), so the
  // form opens on the location chooser. Both are seeded with no buildings on
  // a fresh install, so picking one reveals the plain name/phone form.
  await page.getByRole("button", { name: "On Base" }).click();

  await page.getByPlaceholder("John").fill(GUEST.firstName);
  await page.getByPlaceholder("Smith").fill(GUEST.lastName);
  await page.getByPlaceholder("07700 900000").fill(GUEST.phone);
  await page.locator('input[type="checkbox"]').first().check();
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  await expect(page).toHaveURL(/\/portal\/success/);
  await expect(page.getByRole("heading", { name: "You're connected!" })).toBeVisible();

  // The mock records every request; find the authorize.
  const res = await page.request.get(`${MOCK_URL}/__requests`);
  const recorded = (await res.json()) as RecordedRequest[];
  const authorize = recorded.find(
    (r) =>
      r.method === "POST" &&
      /\/api\/s\/default\/cmd\/stamgr$/.test(r.path) &&
      typeof r.body === "object" &&
      r.body.cmd === "authorize-guest",
  );
  expect(authorize, "mock never received authorize-guest").toBeTruthy();
  expect((authorize!.body as { mac?: string }).mac).toBe(MAC_CANONICAL);
});
