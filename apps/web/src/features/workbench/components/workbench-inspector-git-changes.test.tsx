import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InspectorGitChangesSection } from "./workbench-inspector-git-changes.js";
import { deriveInspectorGitChangeState } from "./workbench-inspector-git-status.js";

const appChange = {
  diff: "--- a/apps/web/src/app.tsx\n+++ b/apps/web/src/app.tsx\n@@ -1 +1,2 @@\n-old\n+new\n+next",
  kind: "update" as const,
  path: "apps/web/src/app.tsx",
};
const changes = [
  appChange,
  {
    diff: "--- /dev/null\n+++ b/README.md\n@@ -0,0 +1 @@\n+hello",
    kind: "create" as const,
    path: "README.md",
  },
];

describe("InspectorGitChangesSection", () => {
  it("renders only the aggregate summary without a file tree or panel background", () => {
    const markup = renderToStaticMarkup(
      <InspectorGitChangesSection
        changeCount={changes.length}
        changeStats={{ additions: 3, removals: 1 }}
        onCommitChanges={() => undefined}
      />,
    );

    expect(markup).toContain('aria-label="未提交变更"');
    expect(markup).toContain('aria-label="变更统计"');
    expect(markup).toContain("2 个变更");
    expect(markup).toContain("+3");
    expect(markup).toContain("-1");
    expect(markup).toContain('aria-label="提交 2 个未提交变更"');
    expect(markup).not.toContain('aria-label="变更文件导航"');
    expect(markup).not.toContain("apps/web/src/app.tsx");
    expect(markup).not.toContain("README.md");
    expect(markup).toContain(
      'aria-label="变更统计" class="flex min-h-6 items-center gap-1.5 px-2 text-caption text-muted-foreground"',
    );
    expect(markup).not.toMatch(/aria-label="变更统计"[^>]*(?:bg-|border)/u);
  });

  it("keeps the file count while detailed statistics resolve", () => {
    const markup = renderToStaticMarkup(
      <InspectorGitChangesSection
        changeCount={changes.length}
        changeStats={undefined}
        onCommitChanges={() => undefined}
      />,
    );

    expect(markup).toContain("2 个变更");
    expect(markup).not.toContain("新增 0 行");
    expect(markup).not.toContain("+0");
    expect(markup).not.toContain('aria-label="变更文件导航"');
  });

  it("merges staged and unstaged patches for the same file", () => {
    const state = deriveInspectorGitChangeState(
      {
        baseBranches: ["origin/main"],
        branch: "feat/context",
        branches: ["feat/context"],
        repositoryMode: "root",
        snapshot: "a".repeat(64),
        staged: [{ ...appChange, diff: "" }],
        unstaged: [{ ...appChange, diff: "" }],
      },
      {
        baseBranches: ["origin/main"],
        branch: "feat/context",
        branches: ["feat/context"],
        repositoryMode: "root",
        snapshot: "a".repeat(64),
        staged: [appChange],
        unstaged: [{ ...appChange, diff: "@@ -3 +3 @@\n-before\n+after" }],
      },
    );

    expect(state.displayChanges).toHaveLength(1);
    expect(state.displayChanges[0]?.diff).toContain("before");
    expect(state.changeStats).toEqual({ additions: 3, removals: 2 });
  });

  it("ignores detailed stats from an outdated Git snapshot", () => {
    const state = deriveInspectorGitChangeState(
      {
        baseBranches: [],
        branch: "main",
        branches: ["main"],
        repositoryMode: "root",
        snapshot: "b".repeat(64),
        staged: [],
        unstaged: [{ ...appChange, diff: "" }],
      },
      {
        baseBranches: [],
        branch: "main",
        branches: ["main"],
        repositoryMode: "root",
        snapshot: "c".repeat(64),
        staged: [],
        unstaged: [appChange],
      },
    );

    expect(state.changeStats).toBeUndefined();
    expect(state.displayChanges[0]?.diff).toBe("");
  });
});
