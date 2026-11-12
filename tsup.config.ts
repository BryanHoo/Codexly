import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    "scheduled-task-recurrence-worker": "packages/server/src/scheduled-task-recurrence-worker.js",
    "historical-attachment-worker": "packages/core/src/historical-attachment-worker.js",
    "codex-jsonl-frame-worker": "packages/provider-codex/src/codex-jsonl-frame-worker.js",
    "client/index": "packages/client/src/index.ts",
    "core/index": "packages/core/src/index.ts",
    "protocol/index": "packages/protocol/src/index.ts",
    "providers/claude/index": "packages/provider-claude/src/index.ts",
    "providers/codex/index": "packages/provider-codex/src/index.ts",
    "server/index": "packages/server/src/index.ts",
    "sqlite-state-worker": "packages/server/src/sqlite-state-worker.js",
  },
  bundle: true,
  // Node 与 Web 共用 dist；清除旧 Node 哈希文件，但保留刚构建的前端及预压缩资源。
  clean: ["!web/**"],
  dts: false,
  esbuildOptions(options) {
    // Fastify 插件仍包含 CommonJS 动态 require，ESM bundle 通过 Node 标准桥接加载内置模块。
    options.banner = {
      js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    };
    options.alias = {
      ...options.alias,
      "@codexly/protocol/application-preferences":
        "./packages/protocol/src/application-preferences.ts",
      "@codexly/provider-acp/network-proxy": "./packages/provider-acp/src/network-proxy.ts",
      "@codexly/protocol/acp-plan-api": "./packages/protocol/src/acp-plan-api.ts",
      "@codexly/protocol/acp-scheduled-plan": "./packages/protocol/src/acp-scheduled-plan.ts",
      "@codexly/protocol/task-queue-storage": "./packages/protocol/src/task-queue-storage.ts",
      "@codexly/core/persistent-historical-attachment-store":
        "./packages/core/src/persistent-historical-attachment-store.ts",
      "@codexly/core/historical-attachment-worker-pool":
        "./packages/core/src/historical-attachment-worker-pool.ts",
      "@codexly/core/historical-attachment-files":
        "./packages/core/src/historical-attachment-files.ts",
      "@codexly/core/app-storage-paths": "./packages/core/src/app-storage-paths.ts",
      "@codexly/core/file-task-queue": "./packages/core/src/file-task-queue.ts",
      "@codexly/core/task-attachments": "./packages/core/src/task-attachments.ts",
      "@codexly/core/persistent-task-queue": "./packages/core/src/persistent-task-queue.ts",
      "@codexly/core": "./packages/core/src/index.ts",
      "@codexly/protocol": "./packages/protocol/src/index.ts",
      "@codexly/provider-claude/network-proxy": "./packages/provider-claude/src/network-proxy.ts",
      "@codexly/provider-claude": "./packages/provider-claude/src/index.ts",
      "@codexly/provider-codex": "./packages/provider-codex/src/index.ts",
      "@codexly/server": "./packages/server/src/index.ts",
    };
  },
  format: ["esm"],
  minify: true,
  outDir: "dist",
  platform: "node",
  sourcemap: false,
  splitting: true,
  target: "node24",
  treeshake: true,
});
