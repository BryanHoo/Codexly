import { expect, it } from "vitest";
import { resolveDesktopTaskRoot } from "./workbench-task-root.js";

it("isolates worktree terminal scopes and restores their directory", () => {
  const root = { id: "root", path: "/repo" };
  const input = {
    projectRoots: [root],
    selectedRoot: root,
    taskId: "task-a",
    taskKnown: false,
    metadataTaskId: "task-a",
    reportedWorkspacePath: "/repo-topic",
    temporary: false,
  };
  expect(resolveDesktopTaskRoot(input)).toEqual({
    activeRootId: "worktree:task-a",
    projectRoots: [{ id: "worktree:task-a", path: "/repo-topic" }],
    selectedRootPath: "/repo-topic",
  });
  expect(
    resolveDesktopTaskRoot({ ...input, taskId: "task-b", metadataTaskId: "task-b" }).activeRootId,
  ).toBe("worktree:task-b");
  expect(
    resolveDesktopTaskRoot({ ...input, metadataTaskId: undefined }).selectedRootPath,
  ).toBeUndefined();
});
