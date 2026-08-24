import { rm } from "node:fs/promises";

// 只清理可再生成的构建产物及旧版增量缓存，避免脚本触及源码和用户数据。
await Promise.all(
  [
    "dist",
    "coverage",
    "playwright-report",
    "test-results",
    ".cache",
    "tsconfig.node.tsbuildinfo",
    "apps/web/tsconfig.app.tsbuildinfo",
    "apps/web/tsconfig.node.tsbuildinfo",
    "packages/client/tsconfig.tsbuildinfo",
    "packages/core/tsconfig.tsbuildinfo",
    "packages/protocol/tsconfig.tsbuildinfo",
    "packages/provider-codex/tsconfig.tsbuildinfo",
    "packages/server/tsconfig.tsbuildinfo",
    "tests/tsconfig.tsbuildinfo",
  ].map((path) => rm(path, { force: true, recursive: true })),
);
