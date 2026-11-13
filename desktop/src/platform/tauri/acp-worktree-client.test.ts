import { expect, it, vi } from "vitest";
import { TauriSidebarClient, type InvokeImplementation } from "./sidebar-client.js";

class Client extends TauriSidebarClient {
  mode: "legacy" | "acp" = "acp";
  protected override applicationRuntime() {
    return Promise.resolve(this.mode);
  }
}
it.each(["codex", "claude"] as const)(
  "%s 工作树创建明确选择 ACP，保留路径和实际响应",
  async (engine) => {
    const response = { task: { id: "acp-task", engine, workspacePath: "C:\\项目\\树" } };
    const invoke = vi.fn().mockResolvedValue(response);
    const ensureRuntime = vi.fn();
    const connectEvents = vi.fn();
    const client = new Client({
      invoke: invoke as InvokeImplementation,
      ensureRuntime,
      connectEvents,
    });
    const input = { rootPath: "C:\\项目", worktreePath: "C:\\项目\\树", engine };
    expect(await client.startWorktreeTask("p", input)).toBe(response);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("start_worktree_task", {
      projectId: "p",
      input,
      agentRuntime: "acp",
    });
    expect(ensureRuntime).not.toHaveBeenCalled();
    expect(connectEvents).not.toHaveBeenCalled();
  },
);
it("旧工作树请求保持原参数，ACP 失败不回退或重试", async () => {
  const invoke = vi.fn().mockResolvedValue({ task: { id: "legacy" } });
  const client = new Client({ invoke: invoke as InvokeImplementation });
  client.mode = "legacy";
  const input = { rootPath: "/repo", worktreePath: "/tree" };
  await client.startWorktreeTask("p", input);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("start_worktree_task", { projectId: "p", input });
  invoke.mockClear();
  invoke.mockRejectedValue(new Error("创建失败"));
  client.mode = "acp";
  await expect(client.startWorktreeTask("p", input)).rejects.toThrow("创建失败");
  expect(invoke).toHaveBeenCalledOnce();
});
