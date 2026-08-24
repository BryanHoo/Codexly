import { defineConfig } from "vitest/config";

import { vitestAliases } from "./vitest.config.js";

export default defineConfig({
  resolve: { alias: vitestAliases },
  test: {
    // 压力测试串行执行，避免并发用例互相污染墙钟和 Heap 预算。
    fileParallelism: false,
    include: ["{apps,packages}/**/*.performance.test.{ts,tsx}"],
    maxWorkers: 1,
    passWithNoTests: true,
    pool: "threads",
    restoreMocks: true,
    testTimeout: 30_000,
  },
});
