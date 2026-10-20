import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    // 提前打包懒加载面板的 Tabs，避免测试中途重新优化依赖、重载页面并重复加载 React。
    include: ["@tauri-apps/api/mocks", "@tanstack/react-virtual", "radix-ui/popover", "radix-ui/tabs", "zustand/react/shallow", "@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-webgl", "marked", "remend", "@codexly/ui > react-zoom-pan-pinch"],
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
      instances: [
        { browser: "chromium" },
        { browser: "webkit" },
      ],
      provider: playwright(),
      viewport: { height: 900, width: 1_440 },
    },
    include: ["src/**/*.browser.test.tsx"],
  },
});
