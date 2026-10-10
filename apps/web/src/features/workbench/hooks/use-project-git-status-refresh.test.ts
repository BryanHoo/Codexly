import { describe, expect, it, vi } from "vitest";

import { refreshProjectGitStatusForScopeChange } from "./use-project-git-status-refresh.js";

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

  it("does not refresh a changed Task scope when Git is unavailable", () => {
    const refresh = vi.fn();
    expect(refreshProjectGitStatusForScopeChange("old", "new", false, refresh)).toBe("new");
    expect(refresh).not.toHaveBeenCalled();
  });
});
