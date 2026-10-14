import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { cacheCommittedGitStatus } from "./commit-changes-controller.js";
import { projectGitRemoteQueryOptions } from "@codexly/frontend-core/project-git-push";

const status = {
  baseBranches: ["origin/main", "main"],
  branch: "main",
  branches: ["main"],
  repositoryMode: "root" as const,
  snapshot: "b".repeat(64),
  staged: [],
  unstaged: [],
};
const history = {
  branch: "main",
  commits: [],
  nextCursor: null,
  repositories: [],
  repository: null,
  repositoryMode: "root" as const,
};

describe("cacheCommittedGitStatus", () => {
  it("reads fresh remote metadata when the worktree snapshot changes on the same branch", async () => {
    const queryClient = new QueryClient();
    const pushProjectCommits = vi
      .fn()
      .mockResolvedValueOnce({
        branch: "main",
        pushStatus: "checked",
        pushError: null,
        remoteState: { head: "old" },
      })
      .mockResolvedValueOnce({
        branch: "main",
        pushStatus: "checked",
        pushError: null,
        remoteState: { head: "new" },
      });
    await queryClient.fetchQuery(
      projectGitRemoteQueryOptions("p", "/repo", "main", "a".repeat(64), { pushProjectCommits }),
    );
    const next = await queryClient.fetchQuery(
      projectGitRemoteQueryOptions("p", "/repo", "main", "b".repeat(64), { pushProjectCommits }),
    );
    expect(next.remoteState?.head).toBe("new");
    expect(pushProjectCommits).toHaveBeenCalledTimes(2);
    queryClient.clear();
  });
  it("writes authoritative status and history without invalidation", () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    cacheCommittedGitStatus(
      queryClient,
      "codexly",
      "/workspace/Codexly",
      undefined,
      status,
      history,
    );

    expect(
      queryClient.getQueryData(["projects", "codexly", "/workspace/Codexly", "git-status"]),
    ).toEqual(status);
    expect(
      queryClient.getQueryData(["projects", "codexly", "/workspace/Codexly", "git-history", null]),
    ).toEqual({ pageParams: [undefined], pages: [history] });
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
