import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/performance",
  fullyParallel: false,
  forbidOnly: true,
  outputDir: ".artifacts/playwright-performance",
  reporter: "list",
  retries: 0,
  timeout: 600_000,
  workers: 1,
  use: {
    locale: "zh-CN",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-performance",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
