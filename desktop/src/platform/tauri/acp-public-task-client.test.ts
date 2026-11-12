import { expect, it, vi } from "vitest";
import { TauriSidebarClient } from "./sidebar-client.js";
import type { InvokeImplementation } from "./native-client.js";
import { createProjectRuntimeManager } from "@/features/conversation/runtime/project-runtime.js";
import { createTaskStore } from "@/features/conversation/runtime/task-store.js";

class AcpClient extends TauriSidebarClient {
  protected override applicationRuntime() {
    return Promise.resolve("acp" as const);
  }
}
it("订阅身份兼容仅提供 getRandomValues 的旧 WebKit", async () => {
  const invoke = vi.fn().mockResolvedValue(null);
  const client = new AcpClient({
    invoke: invoke as InvokeImplementation,
    connectEvents: async () => undefined,
  });
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  try {
    await client.retainTaskSubscription("p", "t");
    expect(invoke.mock.calls[0]?.[1]).toMatchObject({
      params: { leaseId: expect.stringMatching(/^[0-9a-f-]{36}$/) },
    });
    await client.releaseTaskSubscription("p", "t");
  } finally {
    vi.unstubAllGlobals();
  }
});
it("公共快照和订阅在 ACP 只走共享宿主，保留参数并复用订阅身份", async () => {
  const invoke = vi.fn(async () => ({ snapshot: { id: "t" } }));
  const ensureRuntime = vi.fn();
  const client = new AcpClient({
    invoke: invoke as InvokeImplementation,
    ensureRuntime,
    connectEvents: () => Promise.resolve(),
  });
  const signal = new AbortController().signal;
  await client.readTask("p", "t", { cursor: "older", summary: true, signal });
  await client.retainTaskSubscription("p", "t");
  await client.retainTaskSubscription("p", "t");
  await client.releaseTaskSubscription("p", "t");
  const calls = invoke.mock.calls as unknown as [string, Record<string, unknown>][];
  expect(calls.every(([command]) => command === "acp_task_request")).toBe(true);
  expect(calls[0]?.[1]).toMatchObject({
    projectId: "p",
    method: "task.read",
    params: { taskId: "t", cursor: "older", summary: true },
  });
  const leases = calls.slice(1).map(([, args]) => (args["params"] as { leaseId: string }).leaseId);
  expect(leases).toHaveLength(3);
  expect(new Set(leases).size).toBe(1);
  expect(ensureRuntime).not.toHaveBeenCalled();
});

it("读取失败和已取消读取不回退旧命令", async () => {
  const invoke = vi.fn().mockRejectedValue(new Error("宿主读取失败"));
  const connectEvents = vi.fn(async () => undefined);
  const client = new AcpClient({ invoke: invoke as InvokeImplementation, connectEvents });
  await expect(client.readTask("p", "t")).rejects.toThrow("宿主读取失败");
  const controller = new AbortController();
  controller.abort(new Error("取消读取"));
  await expect(client.readTask("p", "t", { signal: controller.signal })).rejects.toThrow(
    "取消读取",
  );
  expect(invoke).toHaveBeenCalledOnce();
  expect(invoke.mock.calls[0]?.[0]).toBe("acp_task_request");
  expect(connectEvents).toHaveBeenCalledOnce();
});

it("释放失败重试复用身份，快速重挂等待旧释放确认并生成新身份", async () => {
  let finishRelease = () => undefined as void;
  const waiting = new Promise<null>((resolve) => {
    finishRelease = () => resolve(null);
  });
  const invoke = vi.fn().mockResolvedValue(null);
  const client = new AcpClient({
    invoke: invoke as InvokeImplementation,
    connectEvents: async () => undefined,
  });
  await client.retainTaskSubscription("p", "t");
  invoke.mockRejectedValueOnce(new Error("断线"));
  await expect(client.releaseTaskSubscription("p", "t")).rejects.toThrow("断线");
  invoke.mockReturnValueOnce(waiting);
  const release = client.releaseTaskSubscription("p", "t");
  const retain = client.retainTaskSubscription("p", "t");
  await vi.waitFor(() => {
    expect(invoke).toHaveBeenCalledTimes(3);
  });
  finishRelease();
  await Promise.all([release, retain]);
  const leases = invoke.mock.calls.map(
    (call) => (call[1] as { params: { leaseId: string } }).params.leaseId,
  );
  expect(leases[0]).toBe(leases[1]);
  expect(leases[1]).toBe(leases[2]);
  expect(leases[3]).not.toBe(leases[2]);
});

it("未知释放不启动宿主，不同客户端订阅身份隔离", async () => {
  const invoke = vi.fn().mockResolvedValue(null);
  const options = { invoke: invoke as InvokeImplementation, connectEvents: async () => undefined };
  const first = new AcpClient(options);
  const second = new AcpClient(options);
  await first.releaseTaskSubscription("p", "unknown");
  expect(invoke).not.toHaveBeenCalled();
  await first.retainTaskSubscription("p", "t");
  await second.retainTaskSubscription("p", "t");
  const calls = invoke.mock.calls as unknown as [string, { params: { leaseId: string } }][];
  expect(calls[0]?.[1].params.leaseId).not.toBe(calls[1]?.[1].params.leaseId);
});

it("旧运行时继续使用原快照与订阅命令", async () => {
  const invoke = vi.fn().mockResolvedValue({ snapshot: { id: "t" } });
  const client = new TauriSidebarClient({
    invoke: invoke as InvokeImplementation,
    connectEvents: async () => undefined,
  });
  await client.readTask("p", "t", { summary: false });
  await client.retainTaskSubscription("p", "t");
  await client.releaseTaskSubscription("p", "t");
  expect(invoke.mock.calls.map((call) => call[0])).toEqual([
    "read_task",
    "retain_task_subscription",
    "release_task_subscription",
  ]);
  expect(invoke.mock.calls[0]?.[1]).toEqual({
    projectId: "p",
    taskId: "t",
    cursor: null,
    summary: false,
  });
});

it("ProjectRuntime 多视图复用同一任务订阅，最后离开才释放 ACP", async () => {
  const response = {
    checkpoint: { sequence: 7, sessionId: "session" },
    snapshot: {
      runtime: "acp" as const,
      engine: "claude" as const,
      id: "t",
      projectId: "p",
      title: "历史任务",
      pinned: false,
      updatedAt: "2026-11-12T00:00:00Z",
      status: "idle" as const,
      goal: null,
      plan: null,
      contextUsage: null,
      pendingRequests: [],
      turns: [],
      turnsNextCursor: null,
    },
  };
  const invoke = vi.fn().mockResolvedValue(response);
  const ensureRuntime = vi.fn();
  const client = new AcpClient({
    invoke: invoke as InvokeImplementation,
    ensureRuntime,
    connectEvents: async () => undefined,
    subscribeAgentEvents: () => () => undefined,
  });
  const manager = createProjectRuntimeManager(client);
  const snapshot = await client.readTask("p", "t");
  const store = createTaskStore({ projectId: "p", taskId: "t" }, snapshot);
  const recover = async () => client.readTask("p", "t");
  const detachFirst = manager.attachTaskStore(snapshot, store, recover);
  const detachSecond = manager.attachTaskStore(snapshot, store, recover);
  try {
    await vi.waitFor(() => {
      expect(store.getState().writeAccess).toBe("writable");
    });
    expect(store.getState().checkpoint).toEqual(response.checkpoint);
    detachFirst();
    await Promise.resolve();
    expect(invoke.mock.calls).toHaveLength(2);
    detachSecond();
    await vi.waitFor(() => {
      expect(invoke.mock.calls).toHaveLength(3);
    });
    expect(invoke.mock.calls.map((call) => (call[1] as { method: string }).method)).toEqual([
      "task.read",
      "task.retain",
      "task.release",
    ]);
    expect(ensureRuntime).not.toHaveBeenCalled();
  } finally {
    detachFirst();
    detachSecond();
    manager.dispose();
  }
});
