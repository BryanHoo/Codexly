import { expect, it, vi } from "vitest";
import { TauriSidebarClient, type InvokeImplementation } from "./sidebar-client.js";

it("creates and starts a worktree task without adding or switching projects", async () => {
  const invoke = vi.fn(async (command: string) =>
    command === "create_task_worktree"
      ? { worktree: { path: "/repo-topic", branch: "topic", current: false } }
      : { task: { id: "task", projectId: "project", workspacePath: "/repo-topic" } },
  );
  const client = new TauriSidebarClient({
    ensureRuntime: async () => undefined,
    invoke: invoke as InvokeImplementation,
  });
  await client.createTaskWorktree("project", "/repo", {
    branch: "topic",
    expectedSnapshot: "snapshot",
  });
  await client.startWorktreeTask("project", { rootPath: "/repo", worktreePath: "/repo-topic" });
  expect(invoke).toHaveBeenNthCalledWith(1, "create_task_worktree", {
    projectId: "project",
    rootPath: "/repo",
    input: { branch: "topic", expectedSnapshot: "snapshot" },
  });
  expect(invoke).toHaveBeenNthCalledWith(2, "start_worktree_task", {
    projectId: "project",
    input: { rootPath: "/repo", worktreePath: "/repo-topic" },
  });
});
