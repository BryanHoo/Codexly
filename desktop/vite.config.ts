import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { projectLanguagePlugin } from "../tools/project-language-plugin.mjs";

const tauriDevHost = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [
    projectLanguagePlugin(),
    react(), tailwindcss(),
  ],
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
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: tauriDevHost || false,
    hmr: tauriDevHost
      ? {
          protocol: "ws",
          host: tauriDevHost,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    outDir: "dist",
    manifest: true,
    chunkSizeWarningLimit: 512,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              // 宏与专用支持 Grammar 独立加载，避免继续放大主 C++ Chunk。
              includeDependenciesRecursively: false,
              name: "grammar-cpp-support",
              test: /@shikijs[\\/]langs[\\/]dist[\\/](?:cpp-macro|regexp|glsl)\.mjs$/u,
            },
            {
              // React 运行时保持自包含，降低工作台主入口的首屏解析体积。
              includeDependenciesRecursively: false,
              name: "react-runtime",
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/u,
            },
          ],
        },
      },
    },
    // Windows 使用 WebView2，其余桌面平台使用 WebKit，避免为无关浏览器额外转译。
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome116" : "safari17.5",
    sourcemap: process.env.TAURI_ENV_DEBUG === "true",
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
