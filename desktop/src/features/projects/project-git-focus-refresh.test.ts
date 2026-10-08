import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { installProjectGitStatusFocusRefresh } from "./project-git-focus-refresh.js";

class FocusTarget {
  readonly #listeners = new Set<() => void>();

  public addEventListener(type: "focus", listener: () => void): void {
    if (type === "focus") this.#listeners.add(listener);
  }

  public removeEventListener(type: "focus", listener: () => void): void {
    if (type === "focus") this.#listeners.delete(listener);
  }

  public focus(): void {
    for (const listener of this.#listeners) listener();
  }
}

describe("installProjectGitStatusFocusRefresh", () => {
  it("refreshes only active Git status queries when the window regains focus", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const gitStatusQuery = vi.fn().mockResolvedValue({ branch: "main", repositoryMode: "root" });
    const unrelatedQuery = vi.fn().mockResolvedValue({ data: [] });
    const gitObserver = new QueryObserver(queryClient, {
      queryFn: gitStatusQuery,
      queryKey: ["projects", "project-1", "/repo", "git-status"],
    });
    const unrelatedObserver = new QueryObserver(queryClient, {
      queryFn: unrelatedQuery,
      queryKey: ["projects"],
    });
    const unsubscribeGit = gitObserver.subscribe(() => undefined);
    const unsubscribeUnrelated = unrelatedObserver.subscribe(() => undefined);
    await Promise.all([gitObserver.refetch(), unrelatedObserver.refetch()]);
    expect(gitObserver.getCurrentResult().data).toEqual({ branch: "main", repositoryMode: "root" });
    gitStatusQuery.mockResolvedValue({ branch: "feature/external-switch", repositoryMode: "root" });
    gitStatusQuery.mockClear();
    unrelatedQuery.mockClear();
    const target = new FocusTarget();

    const dispose = installProjectGitStatusFocusRefresh(queryClient, target);
    target.focus();

    await vi.waitFor(() =>
      expect(gitObserver.getCurrentResult().data).toEqual({
        branch: "feature/external-switch",
        repositoryMode: "root",
      }),
    );
    expect(gitStatusQuery).toHaveBeenCalledOnce();
    expect(unrelatedQuery).not.toHaveBeenCalled();

    dispose();
    gitStatusQuery.mockClear();
    target.focus();
    await Promise.resolve();
    expect(gitStatusQuery).not.toHaveBeenCalled();

    unsubscribeGit();
    unsubscribeUnrelated();
    queryClient.clear();
  });
});

it.each(["none", "children"])("does not refresh %s projects on window focus", async (repositoryMode) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const read = vi.fn().mockResolvedValue({ repositoryMode });
  const observer = new QueryObserver(queryClient, {
    queryKey: ["projects", "plain", "/plain", "git-status"], queryFn: read,
  });
  const unsubscribe = observer.subscribe(() => undefined);
  await observer.refetch();
  read.mockClear();
  const target = new FocusTarget();
  const dispose = installProjectGitStatusFocusRefresh(queryClient, target);
  target.focus();
  await Promise.resolve();
  expect(read).not.toHaveBeenCalled();
  dispose();
  unsubscribe();
  queryClient.clear();
});
