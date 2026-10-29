import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    // 提前打包共享 Tooltip 和懒加载面板，避免中途重新优化依赖、重载页面并重复加载 React。
    include: [
      "@tauri-apps/api/mocks",
      "@tanstack/react-virtual",
      "@codexly/ui > @base-ui/react/tooltip",
      "@codexly/ui > @base-ui/react/toast",
      "@codexly/ui > @base-ui/react/dialog",
      "@codexly/ui > @base-ui/react/drawer",
      "radix-ui/popover",
      "radix-ui/tabs",
      "zustand/react/shallow",
      "@xterm/xterm",
      "@xterm/addon-fit",
      "@xterm/addon-webgl",
      "marked",
      "remend",
      "@codexly/ui > react-zoom-pan-pinch",
      // 双端时间线共用此浏览器套件；从 Web 包定位其私有依赖，避免中途预打包重载 React。
      "../../apps/web > mdast-util-from-markdown",
      "../../apps/web > mdast-util-to-string",
      "../../apps/web > @streamdown/mermaid",
    ],
  },
  resolve: {
    alias: [{ find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) }],
  },
  test: {
    setupFiles: ["./tests/browser/setup.ts"],
    // Keep both engines within desktop/WSL memory limits so layout checks get rendering time.
    maxWorkers: 2,
    browser: {
      enabled: true,
      headless: true,
      instances: [{ browser: "chromium" }, { browser: "webkit" }],
      provider: playwright(),
      viewport: { height: 900, width: 1_440 },
    },
    // 跨端壳层回归放在测试目录，避免两端 Router 注册类型进入同一个应用类型检查。
    include: ["src/**/*.browser.test.tsx", "tests/browser/**/*.browser.test.tsx"],
  },
});
