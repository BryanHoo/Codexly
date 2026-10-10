import type { ProjectGitStatus } from "@codexly/protocol";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type CodexlyGitStatusClient, projectGitStatusQueryOptions } from "./project-queries.js";
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
  it("removes its single focus listener when disposed", () => {
    const target = new EventTarget();
    const removeListener = vi.spyOn(target, "removeEventListener");
    const { coordinator } = createHarness();
    coordinator.subscribeWindowFocus(target);
    coordinator.dispose();
    expect(removeListener).toHaveBeenCalledOnce();
  });

  it("keeps a replacement root registration when an old pane cleans up late", async () => {
    vi.useFakeTimers();
    const { coordinator, getProjectGitStatus, queryClient } = createHarness();
    queryClient.setQueryData(["projects", "project-1", rootPath, "git-status"], gitStatus);
    const cleanupOld = coordinator.observeProject("project-1", rootPath, false);
    coordinator.forgetProject("project-1");
    const cleanupNew = coordinator.observeProject("project-1", rootPath, false);
    cleanupOld();
    coordinator.refreshObservedProject("project-1", rootPath);
    await vi.advanceTimersByTimeAsync(0);
    expect(getProjectGitStatus).toHaveBeenCalledOnce();
    cleanupNew();
    coordinator.dispose();
    queryClient.clear();
  });

  it("reuses a query already fetching outside the coordinator", async () => {
    const cancelled = vi.fn();
    let resolveRequest!: (status: ProjectGitStatus) => void;
    const getProjectGitStatus = vi.fn<CodexlyGitStatusClient["getProjectGitStatus"]>(
      (_projectId, _request, options) => {
        options?.signal?.addEventListener("abort", cancelled);
        return new Promise((resolve) => {
          resolveRequest = resolve;
        });
      },
    );
    const client = { getProjectGitStatus };
    const queryClient = new QueryClient();
    const options = projectGitStatusQueryOptions("project-1", rootPath, client);
    queryClient.setQueryData(options.queryKey, gitStatus);
    const queryRequest = queryClient.fetchQuery(options);
    const coordinator = new ProjectGitStatusCoordinator(queryClient, client);
    const cleanup = coordinator.observeProject("project-1", rootPath, true);
    coordinator.refreshObservedProject("project-1", rootPath);
    expect(getProjectGitStatus).toHaveBeenCalledOnce();
    expect(cancelled).not.toHaveBeenCalled();
    resolveRequest(gitStatus);
    await queryRequest;
    cleanup();
    coordinator.dispose();
    queryClient.clear();
  });

  it("shares focus and route refreshes across the workspace and four panes without cancellations", async () => {
    const target = new EventTarget();
    const addListener = vi.spyOn(target, "addEventListener");
    const cancelled = vi.fn();
    let resolveRequest!: (status: ProjectGitStatus) => void;
    const getProjectGitStatus = vi.fn<CodexlyGitStatusClient["getProjectGitStatus"]>(
      (_projectId, _request, options) => {
        options?.signal?.addEventListener("abort", cancelled);
        return new Promise((resolve) => {
          resolveRequest = resolve;
        });
      },
    );
    const client = { getProjectGitStatus };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const options = projectGitStatusQueryOptions("project-1", rootPath, client);
    queryClient.setQueryData(options.queryKey, gitStatus);
    const coordinator = new ProjectGitStatusCoordinator(queryClient, client);
    const cleanups = Array.from({ length: 5 }, () => {
      const observer = new QueryObserver(queryClient, { ...options, refetchOnMount: false });
      const unsubscribe = observer.subscribe(() => undefined);
      const unobserve = coordinator.observeProject("project-1", rootPath, false);
      return () => {
        unsubscribe();
        unobserve();
      };
    });
    const removeFocus = coordinator.subscribeWindowFocus(target);
    try {
      target.dispatchEvent(new Event("focus"));
      target.dispatchEvent(new Event("focus"));
      for (let index = 0; index < 5; index += 1) {
        coordinator.refreshObservedProject("project-1", rootPath);
      }
      expect(addListener).toHaveBeenCalledOnce();
      expect(getProjectGitStatus).toHaveBeenCalledOnce();
      expect(cancelled).not.toHaveBeenCalled();
      resolveRequest({ ...gitStatus, branch: "external" });
      await vi.waitFor(() => {
        expect(queryClient.getQueryData(options.queryKey)).toMatchObject({ branch: "external" });
      });
      expect(getProjectGitStatus).toHaveBeenCalledOnce();

      cleanups.forEach((cleanup) => {
        cleanup();
      });
      target.dispatchEvent(new Event("focus"));
      expect(getProjectGitStatus).toHaveBeenCalledOnce();
    } finally {
      removeFocus();
      cleanups.forEach((cleanup) => {
        cleanup();
      });
      coordinator.dispose();
      queryClient.clear();
    }
  });

  it("uses one worktree polling timer per root and releases it after the final pane leaves", async () => {
    vi.useFakeTimers();
    let visible = true;
    const { coordinator, getProjectGitStatus, queryClient } = createHarness(() => visible);
    queryClient.setQueryData(["projects", "project-1", rootPath, "git-status"], gitStatus);
    const cleanups = Array.from({ length: 5 }, () =>
      coordinator.observeProject("project-1", rootPath, true),
    );
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getProjectGitStatus).toHaveBeenCalledOnce();
    cleanups.slice(0, 4).forEach((cleanup) => {
      cleanup();
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getProjectGitStatus).toHaveBeenCalledTimes(2);
    visible = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getProjectGitStatus).toHaveBeenCalledTimes(2);
    cleanups[4]?.();
    expect(vi.getTimerCount()).toBe(0);
    coordinator.dispose();
    queryClient.clear();
  });

  it("isolates worktree roots and returns to Task fallback polling when their panes leave", async () => {
    vi.useFakeTimers();
    const { coordinator, getProjectGitStatus, queryClient } = createHarness();
    const secondRoot = "/workspace/worktree";
    for (const root of [rootPath, secondRoot]) {
      queryClient.setQueryData(["projects", "project-1", root, "git-status"], gitStatus);
    }
    const cleanup = coordinator.observeProject("project-1", rootPath, true);
    const cleanupSecond = coordinator.observeProject("project-1", secondRoot, true);
    coordinator.handleActivity("project-1", rootPath, "task-1", "turn_started");
    await vi.advanceTimersByTimeAsync(0);
    getProjectGitStatus.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getProjectGitStatus.mock.calls.map((call) => call[1].rootPath).sort()).toEqual(
      [rootPath, secondRoot].sort(),
    );
    cleanup();
    cleanupSecond();
    getProjectGitStatus.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getProjectGitStatus).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(PROJECT_GIT_STATUS_POLL_INTERVAL_MS - 10_000);
    expect(getProjectGitStatus).toHaveBeenCalledOnce();
    coordinator.dispose();
    queryClient.clear();
  });

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

  it.each(["none", "children"] as const)(
    "stops automatic polling for %s projects and resumes only after manual detection",
    async (repositoryMode) => {
      const unavailableStatus = { ...nonGitStatus, repositoryMode };
      vi.useFakeTimers();
      const getProjectGitStatus = vi
        .fn<CodexlyGitStatusClient["getProjectGitStatus"]>()
        .mockResolvedValueOnce(unavailableStatus)
        .mockResolvedValueOnce(gitStatus)
        .mockResolvedValueOnce(unavailableStatus);
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const coordinator = new ProjectGitStatusCoordinator(queryClient, { getProjectGitStatus });

      coordinator.handleActivity("project-1", rootPath, "task-1", "turn_started");
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(PROJECT_GIT_STATUS_POLL_INTERVAL_MS * 2);
      coordinator.handleActivity("project-1", rootPath, "task-1", "file_changed");
      await vi.advanceTimersByTimeAsync(PROJECT_GIT_STATUS_FILE_CHANGE_DEBOUNCE_MS);
      coordinator.handleGitMetadataChanged("project-1", rootPath);
      await vi.advanceTimersByTimeAsync(PROJECT_GIT_STATUS_FILE_CHANGE_DEBOUNCE_MS);
      expect(getProjectGitStatus).toHaveBeenCalledTimes(1);

      await coordinator.refreshProject("project-1", rootPath);
      expect(getProjectGitStatus).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(PROJECT_GIT_STATUS_POLL_INTERVAL_MS);
      expect(getProjectGitStatus).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(PROJECT_GIT_STATUS_POLL_INTERVAL_MS * 2);
      expect(getProjectGitStatus).toHaveBeenCalledTimes(3);
      expect(queryClient.getQueryData(["projects", "project-1", rootPath, "git-status"])).toEqual(
        unavailableStatus,
      );
      coordinator.dispose();
    },
  );

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
    ).toMatchObject({ data: undefined, status: "error", fetchStatus: "idle" });
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
