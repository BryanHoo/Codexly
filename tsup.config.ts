import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    "codex-jsonl-frame-worker": "packages/provider-codex/src/codex-jsonl-frame-worker.js",
    "client/index": "packages/client/src/index.ts",
    "core/index": "packages/core/src/index.ts",
    "protocol/index": "packages/protocol/src/index.ts",
    "providers/codex/index": "packages/provider-codex/src/index.ts",
    "server/index": "packages/server/src/index.ts",
    "sqlite-state-worker": "packages/server/src/sqlite-state-worker.js",
  },
  bundle: true,
  clean: false,
  dts: false,
  esbuildOptions(options) {
    // Fastify 插件仍包含 CommonJS 动态 require，ESM bundle 通过 Node 标准桥接加载内置模块。
    options.banner = {
      js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    };
    options.alias = {
      ...options.alias,
      "@codexly/core": "./packages/core/src/index.ts",
      "@codexly/protocol": "./packages/protocol/src/index.ts",
      "@codexly/provider-codex": "./packages/provider-codex/src/index.ts",
      "@codexly/server": "./packages/server/src/index.ts",
    };
  },
  format: ["esm"],
  minify: false,
  outDir: "dist",
  platform: "node",
  sourcemap: false,
  splitting: true,
  target: "node22",
  treeshake: true,
});
