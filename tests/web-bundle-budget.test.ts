import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const checkerPath = join(process.cwd(), "tools/verify-web-bundle.mjs");
const temporaryRoots: string[] = [];

function createBundle(
  options: Readonly<{
    asyncBytes?: number;
    initialBytes?: number;
    workbenchBytes?: number;
    workbenchDependencyCount?: number;
  }> = {},
) {
  const root = mkdtempSync(join(tmpdir(), "code-agent-bundle-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, ".vite"), { recursive: true });
  mkdirSync(join(root, "assets"), { recursive: true });

  // 使用不可压缩内容验证 gzip 预算，避免测试数据大小与传输大小失真。
  writeFileSync(join(root, "assets/index.js"), randomBytes(options.initialBytes ?? 128));
  writeFileSync(join(root, "assets/shared.js"), "export const shared = true;");
  writeFileSync(join(root, "assets/lazy.js"), randomBytes(options.asyncBytes ?? 128));
  writeFileSync(join(root, "assets/lazy-shared.js"), "export const lazyShared = true;");
  writeFileSync(join(root, "assets/workbench.js"), randomBytes(options.workbenchBytes ?? 128));
  writeFileSync(join(root, "assets/workbench-shared.js"), "export const workbenchShared = true;");
  const workbenchDependencies = Array.from(
    { length: options.workbenchDependencyCount ?? 0 },
    (_, index) => `_workbench-dependency-${String(index)}.js`,
  );
  for (const [index, key] of workbenchDependencies.entries()) {
    writeFileSync(
      join(root, "assets", key.slice(1)),
      `export const dependency${String(index)} = true;`,
    );
  }
  writeFileSync(
    join(root, ".vite/manifest.json"),
    JSON.stringify({
      "_lazy-shared.js": { file: "assets/lazy-shared.js" },
      "_shared.js": { file: "assets/shared.js" },
      "_workbench-shared.js": { file: "assets/workbench-shared.js" },
      ...Object.fromEntries(
        workbenchDependencies.map((key) => [key, { file: `assets/${key.slice(1)}` }]),
      ),
      "index.html": {
        dynamicImports: ["src/lazy.ts"],
        file: "assets/index.js",
        imports: ["_shared.js"],
        isEntry: true,
      },
      "src/lazy.ts": {
        file: "assets/lazy.js",
        imports: ["_lazy-shared.js"],
        isDynamicEntry: true,
      },
      "src/features/workbench/components/workbench-shell.tsx": {
        file: "assets/workbench.js",
        imports: ["_workbench-shared.js", ...workbenchDependencies],
        isDynamicEntry: true,
      },
    }),
  );
  return root;
}

function runChecker(root: string, args: readonly string[] = []) {
  return spawnSync(process.execPath, [checkerPath, root, ...args], { encoding: "utf8" });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("Web Bundle 预算门禁", () => {
  it("让统一门禁生成报告并由 CI 只读展示", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const workflow = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");

    expect(packageJson.scripts["bundle:check"]).toContain(
      "--report .artifacts/web-bundle-report.json",
    );
    expect(packageJson.scripts["bundle:report"]).toContain(
      "--read-report .artifacts/web-bundle-report.json",
    );
    expect(workflow).toContain("run: pnpm run bundle:report");
    expect(workflow).not.toContain("run: pnpm run bundle:check");
  });

  it("接受低于首屏和异步预算的生产产物", () => {
    const result = runChecker(createBundle());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Web Bundle budget passed");
    expect(result.stdout).toContain("Initial Top Contributors");
    expect(result.stdout).toContain("Workbench Ready Top Contributors");
    expect(result.stdout).toContain("assets/index.js");
  });

  it("写入可供后续步骤复用的机器报告", () => {
    const root = createBundle();
    const reportPath = join(root, "bundle-report.json");
    const result = runChecker(root, ["--report", reportPath]);

    expect(result.status).toBe(0);
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
      asyncGroups: { contributors: { file: string; gzipBytes: number }[] }[];
      budgets: {
        initialGzipBytes: number;
        maxAsyncGzipBytes: number;
        workbenchReadyGzipBytes: number;
        workbenchReadyRequestCount: number;
      };
      initial: { contributors: { file: string; gzipBytes: number }[]; gzipBytes: number };
      passed: boolean;
      schemaVersion: number;
      violations: unknown[];
      workbenchReady: {
        contributors: { file: string; gzipBytes: number }[];
        gzipBytes: number;
        requestCount: number;
      };
    };
    expect(report).toMatchObject({
      budgets: {
        initialGzipBytes: 280 * 1024,
        maxAsyncGzipBytes: 200 * 1024,
        workbenchReadyGzipBytes: 500 * 1024,
        workbenchReadyRequestCount: 20,
      },
      passed: true,
      schemaVersion: 2,
      violations: [],
    });
    expect(report.initial.contributors.map((contributor) => contributor.file)).toEqual([
      "assets/index.js",
      "assets/shared.js",
    ]);
    expect(report.initial.gzipBytes).toBeGreaterThan(0);
    expect(report.workbenchReady.gzipBytes).toBeGreaterThan(report.initial.gzipBytes);
    expect(report.workbenchReady.requestCount).toBe(4);
    expect(
      report.asyncGroups.some((group) => group.contributors[0]?.file === "assets/lazy.js"),
    ).toBe(true);

    rmSync(join(root, ".vite"), { force: true, recursive: true });
    rmSync(join(root, "assets"), { force: true, recursive: true });
    const displayResult = spawnSync(process.execPath, [checkerPath, "--read-report", reportPath], {
      encoding: "utf8",
    });
    expect(displayResult.status).toBe(0);
    expect(displayResult.stdout).toContain("Web Bundle budget passed");
    expect(displayResult.stdout).toContain("Initial Top Contributors");
    expect(displayResult.stdout).toContain("Workbench Ready Top Contributors");
  });

  it("拒绝超过首屏 gzip 预算的产物", () => {
    const root = createBundle({ initialBytes: 300 * 1024 });
    const reportPath = join(root, "bundle-report.json");
    const result = runChecker(root, ["--report", reportPath]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("initial gzip budget exceeded");
    expect(JSON.parse(readFileSync(reportPath, "utf8"))).toMatchObject({
      passed: false,
      violations: [{ kind: "initial" }],
    });
  });

  it("拒绝超过单个异步加载组 gzip 预算的产物", () => {
    const result = runChecker(createBundle({ asyncBytes: 220 * 1024 }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("async gzip budget exceeded");
  });

  it("拒绝超过工作台就绪 gzip 预算的产物", () => {
    const result = runChecker(
      createBundle({ initialBytes: 230 * 1024, workbenchBytes: 300 * 1024 }),
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("workbench-ready gzip budget exceeded");
  });

  it("拒绝超过工作台就绪请求数预算的产物", () => {
    const result = runChecker(createBundle({ workbenchDependencyCount: 17 }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("workbench-ready request budget exceeded");
  });

  it("拒绝引用缺失 Chunk 的无效 manifest", () => {
    const root = createBundle();
    writeFileSync(
      join(root, ".vite/manifest.json"),
      JSON.stringify({
        "index.html": {
          file: "assets/index.js",
          imports: ["_missing.js"],
          isEntry: true,
        },
      }),
    );

    const result = runChecker(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown manifest chunk");
  });
});
