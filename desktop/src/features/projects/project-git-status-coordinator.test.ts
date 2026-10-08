import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";

import type { ProjectGitStatus } from "@/protocol/index.js";
import { ProjectGitStatusCoordinator } from "./project-git-status-coordinator.js";

const status: ProjectGitStatus = {
  repositoryMode: "none", baseBranches: [], branch: null, branches: [],
  snapshot: "plain", staged: [], unstaged: [],
};

afterEach(() => vi.useRealTimers());

it.each(["none", "children"] as const)("非 Git 项目停止活动刷新、元数据刷新和轮询（%s）", async (repositoryMode) => {
  vi.useFakeTimers();
  const getProjectGitStatus = vi.fn().mockResolvedValue({ ...status, repositoryMode });
  const queryClient = new QueryClient();
  const coordinator = new ProjectGitStatusCoordinator(queryClient, { getProjectGitStatus });
  try {
    coordinator.handleActivity("plain", "/plain", "task-1", "turn_started");
    await vi.advanceTimersByTimeAsync(0);
    coordinator.handleGitMetadataChanged("plain", "/plain");
    coordinator.handleActivity("plain", "/plain", "task-1", "file_changed");
    await vi.advanceTimersByTimeAsync(600_000);
    coordinator.handleActivity("plain", "/plain", "task-1", "turn_completed");
    coordinator.handleActivity("plain", "/plain", "task-2", "turn_started");
    await vi.advanceTimersByTimeAsync(600_000);
    expect(getProjectGitStatus).toHaveBeenCalledOnce();

    await coordinator.refreshProject("plain", "/plain");
    expect(getProjectGitStatus).toHaveBeenCalledTimes(2);
  } finally {
    coordinator.dispose();
    queryClient.clear();
  }
});
