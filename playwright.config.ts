import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  // Windows runner 的浏览器与 Fake Server 并发开销较高，固定上限以减少资源争用型 flaky。
  ...(process.env["CI"] ? { workers: 2 } : {}),
  use: {
    // baseURL 由 worker fixture 注入，确保每个 worker 使用独立 Fake Server。
    locale: "zh-CN",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // CI 中的无头 Chromium 默认禁止读取剪贴板，复制相关用例需要显式授权。
        permissions: ["clipboard-read", "clipboard-write"],
      },
    },
    {
      // Firefox 与 WebKit 覆盖核心流程及浏览器敏感交互，Chromium 继续承担全量回归。
      grep: /@(smoke|cross-browser)/u,
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      grep: /@(smoke|cross-browser)/u,
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
