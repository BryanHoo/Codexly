import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    include: ["@tauri-apps/api/mocks", "@tanstack/react-virtual", "radix-ui/popover", "zustand/react/shallow", "@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-webgl", "marked", "remend"],
  },
  resolve: {
    alias: [{ find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) }],
  },
  test: {
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
