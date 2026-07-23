import { defineConfig } from "@playwright/test";

// The four specs are order-dependent (01 creates the admin 02 logs in as;
// 03 creates the registration 04 logs into), so one worker, no parallelism,
// and the numbered filenames carry the order.
export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://portal:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
});
