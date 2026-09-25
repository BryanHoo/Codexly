import { defineConfig } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  reporter: "line",
  retries: 0,
  testDir: ".",
  testMatch: "source-open.spec.ts",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:4178",
    headless: true,
    viewport: { height: 900, width: 1440 },
  },
  webServer: {
    command: "pnpm --dir .. exec vite --host 127.0.0.1 --port 4178 --strictPort",
    reuseExistingServer: false,
    timeout: 30_000,
    url: "http://127.0.0.1:4178/benchmarks/source-open/index.html",
  },
});
