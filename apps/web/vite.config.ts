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
    // C++ Grammar 是不可继续切分的单模块；原始体积允许至 512 kB，传输体积仍由 bundle:check 约束。
    chunkSizeWarningLimit: 512,
    // dist/web 仅包含前端产物；构建前清理旧哈希文件，避免预压缩阶段重复处理历史资源。
    emptyOutDir: true,
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
            {
              // 日期弹层独占 @floating-ui/react；固定为异步组，避免自动共享提升到首屏。
              entriesAware: true,
              includeDependenciesRecursively: true,
              name: "scheduled-task-floating-ui",
              test: /node_modules[\\/]@floating-ui[\\/]react[\\/]/u,
            },
            {
              // 合并首屏静态依赖，抵消异步功能增加共享图后产生的细碎 Chunk 与重复压缩开销。
              includeDependenciesRecursively: false,
              maxSize: 480 * 1024,
              name: "initial-deps",
              tags: ["$initial"],
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
