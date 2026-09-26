import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("release verification", () => {
  it("documents update commands that revalidate stale npm metadata", () => {
    for (const readmePath of ["README.md", "README.zh-CN.md"]) {
      const readme = readFileSync(readmePath, "utf8");

      expect(readme).not.toContain("--prefer-offline");
      expect(readme).toContain("--registry=https://registry.npmmirror.com");
      expect(readme).toContain("--registry=https://registry.npmjs.org");
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
