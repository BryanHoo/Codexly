import { expect, it } from "vitest";
import type { ProjectGitStatus } from "@/protocol/index.js";
import { deriveInspectorGitChangeState } from "./workbench-inspector-git-status.js";

it("合并暂存和工作区统计，但拒绝其他快照的旧详情", () => {
  const status: ProjectGitStatus = {
    baseBranches: [], branch: "main", branches: ["main"], repositoryMode: "root", snapshot: "a".repeat(64),
    staged: [{ path: "a.txt", kind: "update", diff: "", stats: { additions: 0, removals: 0 } }],
    unstaged: [{ path: "a.txt", kind: "update", diff: "", stats: { additions: 0, removals: 0 } }],
  };
  const details: ProjectGitStatus = {
    ...status,
    staged: [{ ...status.staged[0]!, diff: "+staged", stats: { additions: 3, removals: 2 } }],
    unstaged: [{ ...status.unstaged[0]!, diff: "+worktree", stats: { additions: 4, removals: 1 } }],
  };
  const result = deriveInspectorGitChangeState(status, details);
  expect(result.changeStats).toEqual({ additions: 7, removals: 3 });
  expect(result.displayChanges).toHaveLength(1);
  expect(result.displayChanges[0]?.stats).toEqual({ additions: 7, removals: 3 });
  expect(deriveInspectorGitChangeState(status, { ...details, snapshot: "b".repeat(64) }).changeStats).toBeUndefined();
});


it("详情未加载或属于旧快照时，不向文件树输出占位零统计", () => {
  const status: ProjectGitStatus = {
    baseBranches: [], branch: "main", branches: [], repositoryMode: "root", snapshot: "current",
    staged: [],
    unstaged: [{ path: "new.ts", kind: "create", diff: "", stats: { additions: 0, removals: 0 } }],
  };
  const details: ProjectGitStatus = {
    ...status,
    unstaged: [{ ...status.unstaged[0]!, diff: "+new", stats: { additions: 5, removals: 0 } }],
  };
  expect(deriveInspectorGitChangeState(status, undefined).fileChangesByPath.size).toBe(1);
  expect(deriveInspectorGitChangeState(status, { ...details, snapshot: "old" }).fileChangesByPath.size).toBe(1);
  expect(deriveInspectorGitChangeState(status, details).fileChangesByPath.get("new.ts")?.stats)
    .toEqual({ additions: 5, removals: 0 });
});

it("没有 Diff 正文也展示 numstat，分页汇总采用全仓总数", () => {
  const status = {
    baseBranches: [], branch: "main", branches: [], repositoryMode: "root" as const, snapshot: "current",
    totalChanges: 1500,
    stats: { additions: 3000, removals: 1500 },
    staged: [],
    unstaged: [{ path: "new.ts", kind: "create" as const, diff: "", stats: { additions: 2, removals: 0 } }],
  };
  const result = deriveInspectorGitChangeState(status, undefined);
  expect(result.changeStats).toEqual({ additions: 3000, removals: 1500 });
  expect(result.fileChangesByPath.get("new.ts")?.stats).toEqual({ additions: 2, removals: 0 });
});
