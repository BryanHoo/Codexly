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


it("starts Claude worktree tasks without initializing a Codex runtime", async () => {
  const ensureRuntime = vi.fn(() => Promise.reject(new Error("Codex unavailable")));
  const invoke = vi.fn(async () => ({ task: { id: "claude-task", projectId: "project", provider: "claude" } }));
  const client = new TauriSidebarClient({ ensureRuntime, invoke: invoke as InvokeImplementation });
  const input = { rootPath: "/repo", worktreePath: "/repo/.worktree/topic", engine: "claude" as const };
  await expect(client.startWorktreeTask("project", input)).resolves.toMatchObject({ task: { provider: "claude" } });
  expect(ensureRuntime).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledWith("start_worktree_task", { projectId: "project", input });
});
