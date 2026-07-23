import { test, expect } from "@playwright/test";
import { ADMIN_BOOTSTRAP_PASSWORD, ADMIN_USER, ADMIN_PASS, dismissWhatsNew } from "../helpers";

/**
 * First-boot bootstrap: blank username + ADMIN_PASSWORD signs in as the
 * setup session (only possible while zero admin accounts exist), which is
 * pinned to the admins settings page; create the first real admin there,
 * then prove a normal login with it lands on the dashboard.
 */
test("first boot: setup login, create the first admin, log in as it", async ({ page }) => {
  // The setup path is only open while no admin account exists. On a retry
  // after a partially-complete first attempt the account already exists, so
  // probe via API instead of the form — a failed FORM login would be fine,
  // but a failed API probe costs nothing and keeps the flow deterministic.
  const probe = await page.request.post("/api/admin/login", {
    data: { username: "", password: ADMIN_BOOTSTRAP_PASSWORD },
  });

  if (probe.ok()) {
    // Fresh instance: drive the real UI from the top.
    await page.goto("/admin/login");
    // Username stays blank — while no admin exists, the placeholder says so.
    await expect(page.getByLabel("Username")).toHaveAttribute(
      "placeholder",
      "Username (blank only for first-time setup)",
    );
    await page.getByLabel("Username").fill("");
    await page.locator('input[type="password"]').fill(ADMIN_BOOTSTRAP_PASSWORD);
    await page.getByRole("button", { name: "Sign In" }).click();

    // The setup session is pinned to the admins page.
    await expect(page).toHaveURL(/\/admin\/settings\/admins/);
    // The what's-new dialog may open over this first page load.
    await dismissWhatsNew(page);

    // Create the first personal admin account.
    await page.getByPlaceholder("jsmith").fill(ADMIN_USER);
    await page.getByPlaceholder("Min 8 characters").fill(ADMIN_PASS);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText(ADMIN_USER).first()).toBeVisible();
  }

  // Either way, a normal login with the personal account must now work.
  const fresh = await page.context().browser()!.newContext();
  const loginPage = await fresh.newPage();
  await loginPage.goto("/admin/login");
  // With an admin on the books the setup hint must be gone — the setup
  // login no longer exists, so the page must not advertise it.
  await expect(loginPage.getByLabel("Username")).toHaveAttribute("placeholder", "Username");
  await loginPage.getByLabel("Username").fill(ADMIN_USER);
  await loginPage.locator('input[type="password"]').fill(ADMIN_PASS);
  await loginPage.getByRole("button", { name: "Sign In" }).click();

  await expect(loginPage).toHaveURL(/\/admin$/);
  const cookies = await fresh.cookies();
  expect(cookies.some((c) => c.name === "admin_session")).toBe(true);
  await fresh.close();
});
