import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 最低版本同时覆盖 AbortSignal.any()、AbortSignal.timeout()、toSorted() 与 toSpliced()。
export const supportedBrowserTargets = ["chrome116", "firefox124", "safari17.4"] as const;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
      {
        find: /^shiki$/u,
        replacement: fileURLToPath(
          new URL("./src/shared/components/agent/shiki-bundle.ts", import.meta.url),
        ),
      },
      {
        find: /^shiki\/wasm$/u,
        replacement: fileURLToPath(
          new URL("./src/shared/components/agent/shiki-bundle.ts", import.meta.url),
        ),
      },
      {
        find: /^@pierre\/theming\/themes$/u,
        replacement: fileURLToPath(
          new URL("./src/shared/components/agent/pierre-themes.ts", import.meta.url),
        ),
      },
    ],
  },
  build: {
    emptyOutDir: false,
    manifest: true,
    outDir: "../../dist/web",
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              // 宏与专用支持 Grammar 同组，避免它们回指主 C++ Chunk；共享 SQL 继续独立复用。
              includeDependenciesRecursively: false,
              name: "grammar-cpp-support",
              test: /@shikijs[\\/]langs[\\/]dist[\\/](?:cpp-macro|regexp|glsl)\.mjs$/u,
            },
            {
              // React、React DOM 与 Scheduler 组成自包含运行时，避免只拆单包造成依赖回指。
              includeDependenciesRecursively: false,
              name: "react-runtime",
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/u,
            },
          ],
        },
      },
    },
    sourcemap: false,
    target: [...supportedBrowserTargets],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/v1": "http://127.0.0.1:3210",
    },
    strictPort: true,
  },
});
