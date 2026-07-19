import { defineConfig, devices } from "playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  outputDir: "../test-results/e2e-performance",
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    colorScheme: "light",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
});
