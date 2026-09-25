import { QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import type { ProjectGitStatus } from "@/protocol/index.js";
import { loadProjectGitFileDiff } from "./project-git-file-diff.js";

it("只请求点击文件的工作区补丁，并复用同一快照的缓存", async () => {
  const change = { path: "last[1].txt", kind: "update" as const, diff: "", stats: { additions: 0, removals: 0 } };
  const status: ProjectGitStatus = { branch: "main", baseBranches: [], branches: [], repositoryMode: "root", snapshot: "a".repeat(64), staged: [], unstaged: [change] };
  const getProjectGitStatus = vi.fn(async () => ({ ...status, unstaged: [{ ...change, diff: "+selected" }] }));
  const queryClient = new QueryClient();
  for (let n = 0; n < 2; n++) {
    expect((await loadProjectGitFileDiff(queryClient, { getProjectGitStatus }, "p", "/repo", status, change)).diff).toBe("+selected");
  }
  expect(getProjectGitStatus).toHaveBeenCalledTimes(1);
  expect(getProjectGitStatus.mock.calls[0]).toEqual(["p", {
    rootPath: "/repo", diffPath: change.path, diffStaged: false,
  }, { signal: expect.any(AbortSignal) }]);
  queryClient.clear();
});
