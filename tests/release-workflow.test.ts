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
});
