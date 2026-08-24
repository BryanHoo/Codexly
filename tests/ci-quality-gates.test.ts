import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("CI 质量门禁", () => {
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
      "pnpm run build",
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
