import { describe, expect, it } from "vitest";
import { resolveWorkbenchTaskRoot } from "./workbench-task-root.js";

const primary = { id: "primary", path: "/workspace/source" };
const secondary = { id: "secondary", path: "/workspace/other" };
const base = {
  projectRoots: [primary, secondary],
  selectedRoot: secondary,
  taskId: "task-1",
  taskKnown: true,
  metadataTaskId: "task-1",
  reportedWorkspacePath: undefined,
  temporary: false,
};

describe("resolveWorkbenchTaskRoot", () => {
  it("locks file and Git views to the task worktree", () => {
    expect(
      resolveWorkbenchTaskRoot({
        ...base,
        reportedWorkspacePath: "/workspace/source-feature",
      }),
    ).toEqual({
      activeRootId: "worktree",
      projectRoots: [{ id: "worktree", path: "/workspace/source-feature" }],
      selectedRootPath: "/workspace/source-feature",
    });
  });

  it("does not use a project root while an unknown task loads", () => {
    expect(
      resolveWorkbenchTaskRoot({
        ...base,
        metadataTaskId: undefined,
        taskKnown: false,
      }).selectedRootPath,
    ).toBeUndefined();
    expect(
      resolveWorkbenchTaskRoot({
        ...base,
        reportedWorkspacePath: primary.path,
      }).selectedRootPath,
    ).toBe(secondary.path);
  });
});
