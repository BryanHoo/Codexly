import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("release verification", () => {
  it("blocks publication when any Apple signing or notarization credential is missing", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");
    const prepare = workflow.split("\n  desktop-quality:")[0] ?? "";
    const step = prepare.split("- name: Verify macOS signing and notarization credentials")[1];
    expect(step, "Apple 凭据必须在 prepare 阶段校验，防止发布未公证的安装包").toBeDefined();
    const script = /run: \|\n([\s\S]*?)(?:\n\n|$)/.exec(step ?? "")?.[1]?.replace(/^ {10}/gmu, "");
    if (!script) throw new Error("Apple 凭据校验步骤缺少可执行的 run 脚本");
    const names = [
      "APPLE_CERTIFICATE",
      "APPLE_CERTIFICATE_PASSWORD",
      "APPLE_ID",
      "APPLE_PASSWORD",
      "APPLE_SIGNING_IDENTITY",
      "APPLE_TEAM_ID",
    ];
    const credentials = Object.fromEntries(names.map((name) => [name, `test-secret-${name}`]));
    // Windows' bash alias may launch WSL, which does not inherit these test variables.
    const bash =
      process.platform === "win32"
        ? resolve(
            execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim(),
            "../../../bin/bash.exe",
          )
        : "bash";

    // 执行实际发布门禁，逐项缺失都必须失败，且诊断不能泄露任何凭据值。
    for (const missing of names) {
      const result = spawnSync(bash, ["-eu"], {
        input: script,
        env: { ...process.env, ...credentials, [missing]: "" },
        encoding: "utf8",
      });
      expect(result.status, missing).not.toBe(0);
      expect(result.stderr).toContain(`${missing} is required`);
      expect(result.stdout + result.stderr).not.toContain("test-secret-");
    }
    const result = spawnSync(bash, ["-eu"], {
      input: script,
      env: { ...process.env, ...credentials },
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout + result.stderr).not.toContain("test-secret-");
  });

  it("offers desktop downloads and web startup in both user-facing READMEs", () => {
    for (const [readmePath, installationPath] of [
      ["README.md", "desktop/docs/installation.en.md"],
      ["README.zh-CN.md", "desktop/docs/installation.md"],
    ] as const) {
      const readme = readFileSync(readmePath, "utf8");

      expect(readme).toContain(installationPath);
      expect(readme).toContain("https://github.com/BryanHoo/Codexly/releases");
      expect(readme).toContain("npx --package @bryanhu/codexly@latest codexly start");
    }
  });

  it("documents npm installation and updates without overriding the default registry", () => {
    for (const readmePath of ["README.md", "README.zh-CN.md"]) {
      const readme = readFileSync(readmePath, "utf8");

      expect(readme).not.toContain("--prefer-offline");
      expect(readme).toContain("npm install --global @bryanhu/codexly@latest");
      expect(readme).not.toContain("--registry=");
    }
  });

  it("gates publication on browser tests of the resolved release commit", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");
    expect(workflow).toContain(
      "needs: [prepare, e2e, desktop-quality, desktop-webview, publish-desktop]",
    );
    expect(workflow).toContain("needs: [prepare, e2e, desktop-quality, desktop-webview]");
    expect(workflow).toContain("releaseDraft: true");
    expect(workflow).toContain("ref: ${{ needs.prepare.outputs.sha }}");
    expect(workflow).toContain("pnpm exec playwright test");
    expect(workflow).toContain("chromium firefox webkit");
    expect(workflow).toContain("os: [ubuntu-latest, windows-latest]");
    expect(workflow).not.toContain("CODEAGENT_RELEASE_TOKEN");
    expect(workflow).not.toContain("BryanHoo/CodeAgent");
    expect(workflow).not.toContain("mirror-desktop-updater");
  });

  it("uses the root package manager configuration for every desktop CI job", () => {
    const rootPackage = JSON.parse(readFileSync("package.json", "utf8")) as {
      packageManager: string;
    };
    const desktopPackage = JSON.parse(readFileSync("desktop/package.json", "utf8")) as {
      packageManager: string;
    };
    expect(desktopPackage.packageManager).toBe(rootPackage.packageManager);

    for (const [workflowPath, expectedJobs] of [
      [".github/workflows/desktop-quality.yml", 4],
      [".github/workflows/desktop-webview.yml", 1],
      [".github/workflows/release.yml", 1],
    ] as const) {
      const workflow = readFileSync(workflowPath, "utf8");
      expect(workflow.match(/run_install: false/gu)).toHaveLength(expectedJobs);
      expect(workflow).not.toContain("package_json_file: desktop/package.json");
      expect(workflow).toContain("node-version-file: .node-version");
    }
  });
});
