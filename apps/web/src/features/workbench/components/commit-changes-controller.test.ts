import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { cacheCommittedGitStatus } from "./commit-changes-controller.js";
import {
  projectGitRemoteMutationCallbacks,
  projectGitRemoteQueryOptions,
} from "@codexly/frontend-core/project-git-push";

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
  it("waits for the commit to finish before inspecting a snapshot published by an early metadata event", async () => {
    const queryClient = new QueryClient();
    let committing = false;
    const pushProjectCommits = vi.fn(() =>
      committing
        ? Promise.reject(new Error("Another Git mutation is already in progress"))
        : Promise.resolve({
            branch: "main",
            pushStatus: "checked" as const,
            pushError: null,
          }),
    );
    const options = (snapshot: string, writing: boolean) =>
      projectGitRemoteQueryOptions("p", "/repo", "main", snapshot, { pushProjectCommits }, writing);
    const observer = new QueryObserver(queryClient, options("a".repeat(64), false));
    const unsubscribe = observer.subscribe(() => undefined);
    try {
      await vi.waitFor(() => {
        expect(observer.getCurrentResult().isSuccess).toBe(true);
      });
      committing = true;
      observer.setOptions(options("a".repeat(64), true));
      observer.setOptions(options("b".repeat(64), true));
      await vi.waitFor(() => {
        expect(observer.getCurrentResult().fetchStatus).toBe("idle");
      });
      expect(pushProjectCommits).toHaveBeenCalledTimes(1);
      expect(observer.getCurrentResult().error).toBeNull();
      committing = false;
      observer.setOptions(options("b".repeat(64), false));
      await vi.waitFor(() => {
        expect(observer.getCurrentResult().isSuccess).toBe(true);
      });
      expect(pushProjectCommits).toHaveBeenLastCalledWith("p", "/repo", {
        action: "inspect",
        expectedSnapshot: "b".repeat(64),
      });
    } finally {
      unsubscribe();
      queryClient.clear();
    }
  });
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
  it("refreshes the current snapshot instead of only the key captured before committing", async () => {
    const queryClient = new QueryClient();
    const cached = { branch: "main", pushStatus: "checked" as const, pushError: null };
    const pushProjectCommits = vi.fn(() => Promise.resolve({ ...cached, branch: "current" }));
    const oldOptions = projectGitRemoteQueryOptions("p", "/repo", "main", "a".repeat(64), {
      pushProjectCommits,
    });
    const currentOptions = projectGitRemoteQueryOptions(
      "p",
      "/repo",
      "main",
      "b".repeat(64),
      { pushProjectCommits },
      true,
    );
    queryClient.setQueryData(oldOptions.queryKey, cached);
    queryClient.setQueryData(currentOptions.queryKey, cached);
    const otherKey = ["projects", "other", "/repo", "git-remote"];
    queryClient.setQueryData(otherKey, cached);
    const observer = new QueryObserver(queryClient, currentOptions);
    const unsubscribe = observer.subscribe(() => undefined);
    try {
      const callbacks = projectGitRemoteMutationCallbacks("p", "/repo", queryClient);
      await callbacks.onMutate();
      await callbacks.onSettled();
      expect(pushProjectCommits).not.toHaveBeenCalled();
      expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false);
      observer.setOptions({ ...currentOptions, enabled: true });
      await vi.waitFor(() => {
        expect(observer.getCurrentResult().data?.branch).toBe("current");
      });
      expect(pushProjectCommits).toHaveBeenCalledExactlyOnceWith("p", "/repo", {
        action: "inspect",
        expectedSnapshot: "b".repeat(64),
      });
    } finally {
      unsubscribe();
      queryClient.clear();
    }
  });
  it("discards a late failure from an inspection started before the commit", async () => {
    const queryClient = new QueryClient();
    let failInspection: (error: Error) => void = () => undefined;
    const pushProjectCommits = vi.fn(
      () =>
        new Promise<{
          branch: string;
          pushStatus: "checked";
          pushError: null;
        }>((_resolve, reject) => {
          failInspection = reject;
        }),
    );
    const options = projectGitRemoteQueryOptions("p", "/repo", "main", "a".repeat(64), {
      pushProjectCommits,
    });
    const observer = new QueryObserver(queryClient, options);
    const unsubscribe = observer.subscribe(() => undefined);
    try {
      await vi.waitFor(() => {
        expect(pushProjectCommits).toHaveBeenCalledOnce();
      });
      observer.setOptions({ ...options, enabled: false });
      await projectGitRemoteMutationCallbacks("p", "/repo", queryClient).onMutate();
      failInspection(new Error("Another Git mutation is already in progress"));
      await Promise.resolve();
      expect(queryClient.getQueryState(options.queryKey)?.error).toBeNull();
      expect(queryClient.getQueryState(options.queryKey)?.fetchStatus).toBe("idle");
    } finally {
      unsubscribe();
      queryClient.clear();
    }
  });
  it("continues to report a genuine inspection failure after the write finishes", async () => {
    const queryClient = new QueryClient();
    const pushProjectCommits = vi.fn(() => Promise.reject(new Error("Invalid remote URL")));
    const options = projectGitRemoteQueryOptions(
      "p",
      "/repo",
      "main",
      "b".repeat(64),
      {
        pushProjectCommits,
      },
      true,
    );
    const observer = new QueryObserver(queryClient, options);
    const unsubscribe = observer.subscribe(() => undefined);
    try {
      await projectGitRemoteMutationCallbacks("p", "/repo", queryClient).onSettled();
      observer.setOptions({ ...options, enabled: true });
      await vi.waitFor(() => {
        expect(observer.getCurrentResult().isError).toBe(true);
      });
      expect(observer.getCurrentResult().error?.message).toBe("Invalid remote URL");
      expect(pushProjectCommits).toHaveBeenCalledOnce();
    } finally {
      unsubscribe();
      queryClient.clear();
    }
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
