import type { ProjectGitStatus } from "@code-agent/protocol";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import type { CodeAgentGitStatusClient } from "../projects/project-queries.js";
import { loadProjectGitFileDiff } from "./project-git-file-diff.js";

const summaryChange = { diff: "", kind: "update" as const, path: "src/index.ts" };
const summary: ProjectGitStatus = {
  baseBranches: ["origin/main"],
  branch: "main",
  branches: ["main"],
  repositoryMode: "root",
  snapshot: "a".repeat(64),
  staged: [],
  unstaged: [summaryChange],
};

describe("loadProjectGitFileDiff", () => {
  it("loads the matching detailed change on demand", async () => {
    const detailedChange = {
      ...summaryChange,
      diff: "@@ -1 +1 @@\n-old\n+new\n",
    };
    const getProjectGitStatus = vi.fn<CodeAgentGitStatusClient["getProjectGitStatus"]>(() =>
      Promise.resolve({ ...summary, unstaged: [detailedChange] }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await expect(
      loadProjectGitFileDiff(
        queryClient,
        { getProjectGitStatus },
        "project-1",
        "/workspace/CodeAgent",
        summary,
        summaryChange,
      ),
    ).resolves.toEqual(detailedChange);
    expect(getProjectGitStatus.mock.calls[0]?.[1]).toEqual({
      includeDiff: true,
      rootPath: "/workspace/CodeAgent",
    });
  });

  it("keeps an already detailed change without another request", async () => {
    const getProjectGitStatus = vi.fn<CodeAgentGitStatusClient["getProjectGitStatus"]>();
    const queryClient = new QueryClient();
    const detailedChange = { ...summaryChange, diff: "@@ -0,0 +1 @@\n+new\n" };

    await expect(
      loadProjectGitFileDiff(
        queryClient,
        { getProjectGitStatus },
        "project-1",
        "/workspace/CodeAgent",
        summary,
        detailedChange,
      ),
    ).resolves.toBe(detailedChange);
    expect(getProjectGitStatus).not.toHaveBeenCalled();
  });
});
