import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("CI 质量门禁", () => {
  it("使用 Oxlint 执行静态检查并移除 ESLint 工具链", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const workspaceConfig = readFileSync(join(process.cwd(), "pnpm-workspace.yaml"), "utf8");
    const oxlintConfigPath = join(process.cwd(), ".oxlintrc.json");

    expect(existsSync(oxlintConfigPath)).toBe(true);
    expect(existsSync(join(process.cwd(), "eslint.config.mjs"))).toBe(false);

    // 配置存在后继续验证 type-aware、React 与无障碍规则没有在迁移中降级。
    const oxlintConfig = JSON.parse(readFileSync(oxlintConfigPath, "utf8")) as {
      options: { typeAware: boolean };
      overrides: {
        files: string[];
        plugins?: string[];
        rules: Record<string, unknown>;
      }[];
    };
    const webOverride = oxlintConfig.overrides.find((override) =>
      override.files.includes("apps/web/**/*.{ts,tsx}"),
    );
    const sourceOverride = oxlintConfig.overrides.find((override) =>
      override.files.includes("**/*.{js,mjs,cjs,ts,tsx}"),
    );

    expect(packageJson.scripts["lint"]).toBe(
      "oxlint . --max-warnings 0 --report-unused-disable-directives",
    );
    expect(packageJson.devDependencies["oxlint"]).toBe("catalog:");
    expect(packageJson.devDependencies["oxlint-tsgolint"]).toBe("catalog:");
    expect(
      Object.keys(packageJson.devDependencies).filter((name) => name.includes("eslint")),
    ).toEqual([]);
    expect(workspaceConfig).toContain("  oxlint: 1.79.0");
    expect(workspaceConfig).toContain("  oxlint-tsgolint: 7.0.2001");
    expect(workspaceConfig).not.toMatch(/^\s+eslint(?:-|:)/m);
    expect(oxlintConfig.options.typeAware).toBe(true);
    expect(sourceOverride?.rules["max-lines"]).toEqual([
      "error",
      { max: 500, skipBlankLines: false, skipComments: false },
    ]);
    expect(webOverride?.plugins).toEqual(["jsx-a11y", "react"]);
    expect(webOverride?.rules["react/exhaustive-deps"]).toBe("error");
    expect(webOverride?.rules["react/rules-of-hooks"]).toBe("error");
    expect(webOverride?.rules["jsx-a11y/alt-text"]).toBe("error");
  });

  it("使用最低支持的 Node.js 版本执行 Release 门禁", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      engines: { node: string };
    };
    const ciWorkflow = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
    const releaseWorkflow = readFileSync(
      join(process.cwd(), ".github/workflows/release.yml"),
      "utf8",
    );

    expect(packageJson.engines.node).toBe(">=22.14.0");
    expect(ciWorkflow).not.toContain("node-version: 22.13.0");
    expect(ciWorkflow.match(/node-version: 22\.14\.0/g)).toHaveLength(3);
    expect(releaseWorkflow).toContain("node-version: 22.14.0");
  });

  it("安装支持 Trusted Publisher 的 npm CLI", () => {
    const workflow = readFileSync(join(process.cwd(), ".github/workflows/release.yml"), "utf8");
    const publishingSetupStart = workflow.indexOf("      - name: Setup publishing npm\n");
    const publishStart = workflow.indexOf("      - name: Publish with provenance\n");

    expect(publishingSetupStart).toBeGreaterThanOrEqual(0);
    expect(publishStart).toBeGreaterThan(publishingSetupStart);

    const publishingSetup = workflow.slice(publishingSetupStart, publishStart);
    expect(publishingSetup).toContain("npm install --global npm@11.5.1");
  });

  it("使用 Trusted Publisher OIDC 发布 npm 包", () => {
    const workflow = readFileSync(join(process.cwd(), ".github/workflows/release.yml"), "utf8");
    const publishStart = workflow.indexOf("      - name: Publish with provenance\n");
    const releaseStart = workflow.indexOf("      - name: Create GitHub release\n", publishStart);

    expect(publishStart).toBeGreaterThanOrEqual(0);
    expect(releaseStart).toBeGreaterThan(publishStart);

    // Trusted Publisher 通过 id-token 权限换取短期凭据，流水线不再读取长期 Token。
    expect(workflow).not.toContain("secrets.NPM_TOKEN");
    expect(workflow).not.toContain("NODE_AUTH_TOKEN");
    expect(workflow.slice(publishStart, releaseStart)).toContain(
      'npm publish "${package_tarball}" --access public --provenance',
    );
  });

  it("分离增量构建与 Release clean build", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const workflow = readFileSync(join(process.cwd(), ".github/workflows/release.yml"), "utf8");
    const qualityStepStart = workflow.indexOf("      - name: Run quality gates\n");
    const qualityStepEnd = workflow.indexOf("      - name: Extract release notes\n");
    const qualityCommands = workflow
      .slice(qualityStepStart, qualityStepEnd)
      .split("\n")
      .map((line) => line.trim());

    expect(packageJson.scripts["build"]).toBe(
      "pnpm run typecheck && pnpm --filter @codexly/web build && pnpm run build:node",
    );
    expect(packageJson.scripts["build"]).not.toContain("pnpm run clean");
    expect(packageJson.scripts["build:clean"]).toBe("pnpm run clean && pnpm run build");
    expect(qualityCommands).toContain("pnpm run build:clean");
    expect(qualityCommands).not.toContain("pnpm run build");
  });

  it("将 Release 单元测试拆分为独立单 worker 进程", () => {
    const workflow = readFileSync(join(process.cwd(), ".github/workflows/release.yml"), "utf8");
    const qualityStepStart = workflow.indexOf("      - name: Run quality gates\n");
    const qualityStepEnd = workflow.indexOf("      - name: Extract release notes\n");

    expect(qualityStepStart).toBeGreaterThanOrEqual(0);
    expect(qualityStepEnd).toBeGreaterThan(qualityStepStart);

    const qualityStep = workflow.slice(qualityStepStart, qualityStepEnd);
    const testCommand =
      "CI= pnpm exec vitest run --pool forks --maxWorkers 1 --no-file-parallelism --passWithNoTests";
    const testGroups = [
      "apps/web",
      "packages/client packages/core packages/protocol",
      "packages/provider-codex",
      "packages/server",
      '"$PWD"/src/*.test.ts "$PWD"/tests/*.test.ts --exclude packages/protocol/src/app-update.test.ts',
    ];

    for (const testGroup of testGroups) {
      expect(qualityStep).toContain(`${testCommand} ${testGroup}`);
    }
    expect(qualityStep.match(/CI= pnpm exec vitest run/g)).toHaveLength(testGroups.length);

    for (const gate of [
      "pnpm run audit:prod",
      "pnpm run codex:schema:check",
      "pnpm run format:check",
      "pnpm run lint",
      "pnpm run lint:architecture",
      "pnpm run test:performance",
      "pnpm run build:clean",
      "pnpm run bundle:check",
      "pnpm run package:check",
    ]) {
      expect(qualityStep).toContain(gate);
    }
  });

  it("限制 CI 测试 worker 数量并避免重复创建子进程", () => {
    const vitestConfig = readFileSync(join(process.cwd(), "vitest.config.ts"), "utf8");
    const playwrightConfig = readFileSync(join(process.cwd(), "playwright.config.ts"), "utf8");

    expect(vitestConfig).toContain('process.env["CI"] ? { maxWorkers: 2, pool: "threads" } : {}');
    expect(playwrightConfig).toContain('process.env["CI"] ? { workers: 2 } : {}');
  });

  it("仅在 Linux quality job 中执行覆盖率阈值检查", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const workflow = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
    const qualityJobStart = workflow.indexOf("\n  quality:\n");
    const qualityJobEnd = workflow.indexOf("\n  macos-smoke:\n", qualityJobStart);

    expect(packageJson.scripts["test:coverage"]).toContain("--coverage");
    expect(qualityJobStart).toBeGreaterThanOrEqual(0);
    expect(qualityJobEnd).toBeGreaterThan(qualityJobStart);

    const qualityJob = workflow.slice(qualityJobStart, qualityJobEnd);
    // 条件必须绑定矩阵 OS，避免 Windows 重复生成覆盖率报告。
    expect(qualityJob).toContain(`      - name: Enforce coverage thresholds
        if: matrix.os == 'ubuntu-latest'
        run: pnpm run test:coverage`);
    expect(workflow.match(/run: pnpm run test:coverage/g)).toHaveLength(1);
  });
});
