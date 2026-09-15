import { describe, expect, it, vi } from "vitest";

import {
  refreshProjectGitStatusForScopeChange,
  subscribeProjectGitStatusWindowFocus,
} from "./use-project-git-status-refresh.js";

describe("Project Git status refresh triggers", () => {
  it("refreshes when the active Task scope changes", () => {
    const refresh = vi.fn(() => Promise.resolve());
    let scopeKey = "project-1:task-1:/workspace/project-1";

    scopeKey = refreshProjectGitStatusForScopeChange(scopeKey, scopeKey, true, refresh);
    scopeKey = refreshProjectGitStatusForScopeChange(
      scopeKey,
      "project-1:task-2:/workspace/project-1",
      true,
      refresh,
    );

    expect(scopeKey).toBe("project-1:task-2:/workspace/project-1");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("refreshes on window focus and removes the listener during cleanup", () => {
    const target = new EventTarget();
    const refresh = vi.fn(() => Promise.resolve());
    const cleanup = subscribeProjectGitStatusWindowFocus(refresh, target);

    target.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledOnce();

    cleanup();
    target.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
