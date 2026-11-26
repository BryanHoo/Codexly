import { expect, it, vi } from "vitest";
import { TauriSidebarClient } from "./sidebar-client.js";
import type { InvokeImplementation } from "./native-client.js";

class AcpClient extends TauriSidebarClient {
  protected override applicationRuntime() {
    return Promise.resolve("acp" as const);
  }
}

const task = {
  id: "t",
  projectId: "p",
  title: "新标题",
  pinned: true,
  engine: "claude",
  updatedAt: "2026-11-12T00:00:00Z",
  workspacePath: "/workspace",
};

it.each(["acp", "legacy"] as const)(
  "公共任务管理使用当前运行时及原生响应契约（%s）",
  async (runtime) => {
    const invoke = vi.fn().mockResolvedValue({ task });
    const ensureRuntime = vi.fn();
    const options = {
      invoke: invoke as InvokeImplementation,
      ensureRuntime,
      connectEvents: async () => undefined,
    };
    const client = runtime === "acp" ? new AcpClient(options) : new TauriSidebarClient(options);
    expect(await client.pinTask("p", "t", true)).toEqual({ task });
    expect(await client.renameTask("p", "t", "新标题")).toEqual({ task });
    invoke.mockResolvedValueOnce({ status: "archived", taskId: "t" });
    expect(await client.archiveTask("p", "t")).toEqual({ status: "archived", taskId: "t" });
    expect(await client.unarchiveTask("p", "t")).toEqual({ task });
    invoke.mockResolvedValueOnce({ status: "deleted", taskId: "t" });
    expect(await client.deleteTask("p", "t")).toEqual({ status: "deleted", taskId: "t" });
    const calls = invoke.mock.calls as unknown as [string, Record<string, unknown>][];
    const expected =
      runtime === "acp"
        ? [
            [
              "acp_task_request",
              { projectId: "p", method: "task.pin", params: { taskId: "t", pinned: true } },
            ],
            [
              "acp_task_request",
              { projectId: "p", method: "task.rename", params: { taskId: "t", title: "新标题" } },
            ],
            ...["task.archive", "task.unarchive", "task.delete"].map((method) => [
              "acp_task_request",
              { projectId: "p", method, params: { taskId: "t" } },
            ]),
          ]
        : [
            ["pin_task", { projectId: "p", taskId: "t", pinned: true }],
            ["rename_task", { projectId: "p", taskId: "t", title: "新标题" }],
            ...["archive_task", "unarchive_task", "delete_task"].map((command) => [
              command,
              { projectId: "p", taskId: "t" },
            ]),
          ];
    expect(calls).toEqual(expected);
    expect(ensureRuntime).not.toHaveBeenCalled();
  },
);

it("ACP 管理失败不回退旧执行器，删除失败保留订阅供正常释放", async () => {
  const invoke = vi.fn().mockResolvedValue(null);
  const client = new AcpClient({
    invoke: invoke as InvokeImplementation,
    connectEvents: async () => undefined,
  });
  await client.retainTaskSubscription("p", "t");
  for (const action of [
    () => client.pinTask("p", "t", false),
    () => client.renameTask("p", "t", "标题"),
    () => client.archiveTask("p", "t"),
    () => client.unarchiveTask("p", "t"),
    () => client.deleteTask("p", "t"),
  ]) {
    invoke.mockRejectedValueOnce(new Error("宿主拒绝"));
    await expect(action()).rejects.toThrow("宿主拒绝");
  }
  await client.releaseTaskSubscription("p", "t");
  const calls = invoke.mock.calls as unknown as [
    string,
    { method: string; params: { leaseId?: string } },
  ][];
  expect(calls.every(([command]) => command === "acp_task_request")).toBe(true);
  expect(calls.at(-1)?.[1]).toMatchObject({
    method: "task.release",
    params: { leaseId: calls[0]?.[1].params.leaseId },
  });
});

it.each([false, true])(
  "删除成功清理订阅身份，在途保留也不能遗留已删除任务（pending=%s）",
  async (pending) => {
    let finish = () => undefined as void;
    const retained = new Promise<null>((resolve) => {
      finish = () => resolve(null);
    });
    const invoke = vi.fn().mockResolvedValue(null);
    if (pending) invoke.mockReturnValueOnce(retained);
    const client = new AcpClient({
      invoke: invoke as InvokeImplementation,
      connectEvents: async () => undefined,
    });
    const retain = client.retainTaskSubscription("p", "t");
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledOnce();
    });
    const deleted = client.deleteTask("p", "t");
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(2);
    });
    finish();
    await Promise.all([retain, deleted]);
    await client.releaseTaskSubscription("p", "t");
    expect(invoke).toHaveBeenCalledTimes(2);
  },
);

it("其他任务的订阅操作饱和时，不把已经确认的删除误报为失败", async () => {
  let finish = () => undefined as void;
  const pending = new Promise<null>((resolve) => {
    finish = () => resolve(null);
  });
  const invoke = vi.fn((_command: string, args?: Record<string, unknown>) =>
    args?.["method"] === "task.retain"
      ? pending
      : Promise.resolve({ status: "deleted", taskId: "deleted" }),
  );
  const client = new AcpClient({
    invoke: invoke as InvokeImplementation,
    connectEvents: async () => undefined,
  });
  const retaining = Array.from({ length: 512 }, (_, i) =>
    client.retainTaskSubscription("p", `other-${i}`),
  );
  try {
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(512);
    });
    await expect(client.deleteTask("p", "deleted")).resolves.toEqual({
      status: "deleted",
      taskId: "deleted",
    });
  } finally {
    finish();
    await Promise.all(retaining);
  }
});
