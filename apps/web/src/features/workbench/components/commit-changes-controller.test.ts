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

describe("cacheCommittedGitStatus", () => {
  it("writes authoritative root and child repository status without invalidation", () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    cacheCommittedGitStatus(queryClient, "codexly", "/workspace/Codexly", undefined, status);
    cacheCommittedGitStatus(queryClient, "codexly", "/workspace/Codexly", "apps/web", status);

    expect(
      queryClient.getQueryData(["projects", "codexly", "/workspace/Codexly", "git-status"]),
    ).toEqual(status);
    expect(
      queryClient.getQueryData([
        "projects",
        "codexly",
        "/workspace/Codexly",
        "git-status",
        "apps/web",
      ]),
    ).toEqual(status);
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
