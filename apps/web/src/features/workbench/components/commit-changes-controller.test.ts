import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { cacheCommittedGitStatus } from "./commit-changes-controller.js";

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
