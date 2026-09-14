import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("release verification", () => {
  it("gates publication on browser tests of the resolved release commit", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");
    expect(workflow).toContain("needs: [prepare, e2e]");
    expect(workflow).toContain("ref: ${{ needs.prepare.outputs.sha }}");
    expect(workflow).toContain("pnpm exec playwright test");
    expect(workflow).toContain("chromium firefox webkit");
    expect(workflow).toContain("os: [ubuntu-latest, windows-latest]");
  });
});
