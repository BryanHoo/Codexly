import type { ProjectGitStatus } from "@codexly/protocol";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CodexlyGitStatusClient } from "./project-queries.js";
import {
  PROJECT_GIT_STATUS_FILE_CHANGE_DEBOUNCE_MS,
  PROJECT_GIT_STATUS_POLL_INTERVAL_MS,
  ProjectGitStatusCoordinator,
} from "./project-git-status-coordinator.js";

const gitStatus: ProjectGitStatus = {
  baseBranches: ["origin/main"],
  branch: "main",
  branches: ["main"],
  repositoryMode: "root",
  snapshot: "a".repeat(64),
  staged: [],
  unstaged: [],
};

const nonGitStatus: ProjectGitStatus = {
  baseBranches: [],
  branch: null,
  branches: [],
  repositoryMode: "none",
  snapshot: "b".repeat(64),
  staged: [],
  unstaged: [],
};
const rootPath = "/workspace/project-1";

function createHarness(isPageVisible: () => boolean = () => true) {
  const getProjectGitStatus = vi.fn<CodexlyGitStatusClient["getProjectGitStatus"]>(() =>
    Promise.resolve(gitStatus),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const coordinator = new ProjectGitStatusCoordinator(
    queryClient,
    { getProjectGitStatus },
    {
      isPageVisible,
    },
  );
  return { coordinator, getProjectGitStatus, queryClient };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ProjectGitStatusCoordinator", () => {
  it("uses a 5 minute fallback polling interval", () => {
    expect(PROJECT_GIT_STATUS_POLL_INTERVAL_MS).toBe(300_000);
  });

  it("debounces Git metadata changes without creating an active Task polling cycle", async () => {
    vi.useFakeTimers();
    const { coordinator, getProjectGitStatus } = createHarness();

    coordinator.handleGitMetadataChanged("project-1", rootPath);
    coordinator.handleGitMetadataChanged("project-1", rootPath);
    await vi.advanceTimersByTimeAsync(PROJECT_GIT_STATUS_FILE_CHANGE_DEBOUNCE_MS);
    expect(getProjectGitStatus).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(PROJECT_GIT_STATUS_POLL_INTERVAL_MS * 2);
    expect(getProjectGitStatus).toHaveBeenCalledOnce();
    coordinator.dispose();
  });

  it("uses one Project polling cycle across multiple running Tasks and stops after the final refresh", async () => {
    vi.useFakeTimers();
    const { coordinator, getProjectGitStatus } = createHarness();

    coordinator.handleActivity("project-1", rootPath, "task-1", "turn_started");
    coordinator.handleActivity("project-1", rootPath, "task-1", "turn_started");
    coordinator.handleActivity("project-1", rootPath, "task-2", "turn_started");
    await vi.advanceTimersByTimeAsync(0);
    expect(getProjectGitStatus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(PROJECT_GIT_STATUS_POLL_INTERVAL_MS);
    expect(getProjectGitStatus).toHaveBeenCalledTimes(2);

    coordinator.handleActivity("project-1", rootPath, "task-1", "turn_completed");
    await vi.advanceTimersByTimeAsync(0);
    expect(getProjectGitStatus).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(PROJECT_GIT_STATUS_POLL_INTERVAL_MS);
    expect(getProjectGitStatus).toHaveBeenCalledTimes(4);

    coordinator.handleActivity("project-1", rootPath, "task-2", "turn_completed");
    await vi.advanceTimersByTimeAsync(0);
    expect(getProjectGitStatus).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(PROJECT_GIT_STATUS_POLL_INTERVAL_MS * 2);
    expect(getProjectGitStatus).toHaveBeenCalledTimes(5);
    coordinator.dispose();
  });

  it("debounces file events and serializes a pending refresh behind the in-flight request", async () => {
    vi.useFakeTimers();
    let resolveFirstRequest: ((status: ProjectGitStatus) => void) | undefined;
    const firstRequest = new Promise<ProjectGitStatus>((resolve) => {
      resolveFirstRequest = resolve;
    });
    const getProjectGitStatus = vi
      .fn<CodexlyGitStatusClient["getProjectGitStatus"]>()
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValue(gitStatus);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const coordinator = new ProjectGitStatusCoordinator(queryClient, { getProjectGitStatus });

    coordinator.handleActivity("project-1", rootPath, "task-1", "turn_started");
    coordinator.handleActivity("project-1", rootPath, "task-1", "file_changed");
    coordinator.handleActivity("project-1", rootPath, "task-1", "file_changed");
    await vi.advanceTimersByTimeAsync(PROJECT_GIT_STATUS_FILE_CHANGE_DEBOUNCE_MS);
    expect(getProjectGitStatus).toHaveBeenCalledTimes(1);

    resolveFirstRequest?.(gitStatus);
    await vi.advanceTimersByTimeAsync(0);
    expect(getProjectGitStatus).toHaveBeenCalledTimes(2);
    coordinator.dispose();
  });

  it("skips periodic work while the page is hidden but still performs the terminal refresh", async () => {
    vi.useFakeTimers();
    const { coordinator, getProjectGitStatus } = createHarness(() => false);

    coordinator.handleActivity("project-1", rootPath, "task-1", "turn_started");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(PROJECT_GIT_STATUS_POLL_INTERVAL_MS * 2);
    expect(getProjectGitStatus).toHaveBeenCalledTimes(1);

    coordinator.handleActivity("project-1", rootPath, "task-1", "turn_completed");
    await vi.advanceTimersByTimeAsync(0);
    expect(getProjectGitStatus).toHaveBeenCalledTimes(2);
    coordinator.dispose();
  });

  it("stops automatic polling for non-Git projects and resumes only after manual detection", async () => {
    vi.useFakeTimers();
    const getProjectGitStatus = vi
      .fn<CodexlyGitStatusClient["getProjectGitStatus"]>()
      .mockResolvedValueOnce(nonGitStatus)
      .mockResolvedValueOnce(gitStatus)
      .mockResolvedValueOnce(nonGitStatus);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const coordinator = new ProjectGitStatusCoordinator(queryClient, { getProjectGitStatus });

    coordinator.handleActivity("project-1", rootPath, "task-1", "turn_started");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(PROJECT_GIT_STATUS_POLL_INTERVAL_MS * 2);
    coordinator.handleActivity("project-1", rootPath, "task-1", "file_changed");
    await vi.advanceTimersByTimeAsync(PROJECT_GIT_STATUS_FILE_CHANGE_DEBOUNCE_MS);
    expect(getProjectGitStatus).toHaveBeenCalledTimes(1);

    await coordinator.refreshProject("project-1", rootPath);
    expect(getProjectGitStatus).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(PROJECT_GIT_STATUS_POLL_INTERVAL_MS);
    expect(getProjectGitStatus).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(PROJECT_GIT_STATUS_POLL_INTERVAL_MS * 2);
    expect(getProjectGitStatus).toHaveBeenCalledTimes(3);
    expect(queryClient.getQueryData(["projects", "project-1", rootPath, "git-status"])).toEqual(
      nonGitStatus,
    );
    coordinator.dispose();
  });

  it("retries failed polling automatically and resumes the normal interval after success", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const getProjectGitStatus = vi
      .fn<CodexlyGitStatusClient["getProjectGitStatus"]>()
      .mockRejectedValueOnce(new Error("Git unavailable"))
      .mockResolvedValue(gitStatus);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const coordinator = new ProjectGitStatusCoordinator(
      queryClient,
      { getProjectGitStatus },
      { random: () => 0.5 },
    );

    coordinator.handleActivity("project-1", rootPath, "task-1", "turn_started");
    await vi.advanceTimersByTimeAsync(0);
    expect(getProjectGitStatus).toHaveBeenCalledTimes(1);
    expect(
      queryClient.getQueryState(["projects", "project-1", rootPath, "git-status"]),
    ).toBeUndefined();
    expect(warn).toHaveBeenCalledWith("Codexly internal warning", {
      diagnosticCode: "git_status_poll_failed",
      errorMessage: "Git unavailable",
      projectId: "project-1",
      rootPath,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(getProjectGitStatus).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(PROJECT_GIT_STATUS_POLL_INTERVAL_MS);
    expect(getProjectGitStatus).toHaveBeenCalledTimes(3);
    coordinator.dispose();
  });

  it("caps exponential retry jitter after consecutive failures", async () => {
    vi.useFakeTimers();
    const getProjectGitStatus = vi
      .fn<CodexlyGitStatusClient["getProjectGitStatus"]>()
      .mockRejectedValueOnce(new Error("Git unavailable"))
      .mockRejectedValueOnce(new Error("Git unavailable"))
      .mockRejectedValueOnce(new Error("Git unavailable"))
      .mockResolvedValue(gitStatus);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const coordinator = new ProjectGitStatusCoordinator(
      queryClient,
      { getProjectGitStatus },
      { random: () => 1, retryBaseMs: 100, retryMaxMs: 250 },
    );

    coordinator.handleActivity("project-1", rootPath, "task-1", "turn_started");
    await vi.advanceTimersByTimeAsync(119);
    expect(getProjectGitStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(getProjectGitStatus).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(240);
    expect(getProjectGitStatus).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(249);
    expect(getProjectGitStatus).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(getProjectGitStatus).toHaveBeenCalledTimes(4);
    coordinator.dispose();
  });
});
