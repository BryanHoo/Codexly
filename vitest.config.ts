import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

export const vitestAliases = {
  "@codexly/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
  "@codexly/client": fileURLToPath(new URL("./packages/client/src/index.ts", import.meta.url)),
  "@codexly/protocol": fileURLToPath(new URL("./packages/protocol/src/index.ts", import.meta.url)),
  "@codexly/provider-codex": fileURLToPath(
    new URL("./packages/provider-codex/src/index.ts", import.meta.url),
  ),
  "@codexly/server": fileURLToPath(new URL("./packages/server/src/index.ts", import.meta.url)),
};

export default defineConfig({
  resolve: {
    alias: vitestAliases,
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      // 锁住当前覆盖率整数基线，性能验收由独立压力套件负责。
      thresholds: {
        branches: 59,
        functions: 59,
        lines: 64,
        statements: 63,
        "apps/web/src/features/workbench/components/workbench-composer-submission.ts": {
          branches: 40,
          functions: 60,
          lines: 60,
          statements: 60,
        },
        "packages/provider-codex/src/codex-transcript.ts": {
          branches: 70,
          functions: 85,
          lines: 80,
          statements: 80,
        },
        "packages/server/src/server-delivery.ts": {
          branches: 85,
          functions: 100,
          lines: 90,
          statements: 90,
        },
      },
    },
    exclude: [...configDefaults.exclude, "**/*.performance.test.{ts,tsx}"],
    include: ["{apps,packages,src}/**/*.test.{ts,tsx}", "tests/*.test.ts"],
    // CI 使用线程池避免为每个隔离测试文件重复创建子进程，并限制托管 runner 的并发开销。
    ...(process.env["CI"] ? { maxWorkers: 2, pool: "threads" } : {}),
    passWithNoTests: true,
    restoreMocks: true,
  },
});
