import { expect, it, vi } from "vitest";
import { TauriCatalogClient } from "./catalog-client.js";
import type { InvokeImplementation } from "./native-client.js";
import { TauriSidebarClient } from "./sidebar-client.js";
import type { AgentEventSubscription } from "./runtime.js";

it("ACP 草稿创建保留独立创建键和授权工作目录，不初始化旧引擎", async () => {
  const invoke = vi.fn(async () => ({})),
    ensureRuntime = vi.fn();
  const client = new TauriCatalogClient({ invoke: invoke as InvokeImplementation, ensureRuntime });
  await client.createAcpTask("p", "claude", {
    idempotencyKey: "creation",
    workspacePath: "/project/worktree",
  });
  expect(invoke).toHaveBeenCalledExactlyOnceWith("create_acp_task", {
    projectId: "p",
    engine: "claude",
    idempotencyKey: "creation",
    workspacePath: "/project/worktree",
  });
  expect(ensureRuntime).not.toHaveBeenCalled();
});

it("ACP 按当前会话发送时携带持久幂等身份，不携带旧设置", async () => {
  const invoke = vi.fn(async () => ({}));
  const client = new TauriCatalogClient({
    invoke: invoke as InvokeImplementation,
    ensureRuntime: vi.fn(),
    connectEvents: () => Promise.resolve(),
  });
  const input = { type: "prompt" as const, text: "继续", attachments: [], skills: [] };
  await client.startConfiguredAcpPrompt("p", "t", input, "stable-key");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("acp_task_request", {
    projectId: "p",
    method: "prompt.start",
    params: { taskId: "t", input, idempotencyKey: "stable-key" },
  });
});

it("ACP 历史与会话布尔配置使用任务身份，不初始化旧引擎", async () => {
  const invoke = vi.fn(async () => ({})),
    ensureRuntime = vi.fn(async () => undefined);
  const client = new TauriCatalogClient({
    invoke: invoke as InvokeImplementation,
    ensureRuntime,
    connectEvents: () => Promise.resolve(),
  });
  await client.getAcpTask("p", "t");
  await client.setAcpSessionConfig("p", "t", "enabled", false);
  await client.getAcpSessionState("p", "t");
  expect(invoke).toHaveBeenCalledWith("acp_task_request", {
    projectId: "p",
    method: "session.state.read",
    params: { taskId: "t" },
  });
  expect(ensureRuntime).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledWith("acp_task_request", {
    projectId: "p",
    method: "task.read",
    params: { taskId: "t" },
  });
  expect(invoke).toHaveBeenCalledWith("acp_task_request", {
    projectId: "p",
    method: "session.config.write",
    params: { taskId: "t", configId: "enabled", value: false },
  });
});

it("ACP 历史连接公共事件通道，按任务归属接收流式事件且不启动旧 Codex", async () => {
  const invoke = vi.fn(async () => ({}));
  const connectEvents = vi.fn(async () => undefined),
    ensureRuntime = vi.fn(async () => undefined);
  let subscription: AgentEventSubscription | undefined;
  const client = new TauriSidebarClient({
    invoke: invoke as InvokeImplementation,
    ensureRuntime,
    connectEvents,
    subscribeAgentEvents: (input) => {
      subscription = input;
      return () => undefined;
    },
  });
  await client.getAcpTask("p", "t");
  expect(connectEvents).toHaveBeenCalledOnce();
  expect(ensureRuntime).not.toHaveBeenCalled();
  const onEvent = vi.fn();
  const stop = client.subscribeEvents({
    projectId: "p",
    sessionId: "s",
    afterSequence: 0,
    onEvent,
    onResyncRequired: vi.fn(),
  });
  const event = {
    type: "message.delta",
    taskId: "t",
    turnId: "turn",
    itemId: "item",
    payload: { delta: "回答" },
    sessionId: "s",
    sequence: 1,
    timestamp: new Date().toISOString(),
    provider: "codex",
    version: 2,
  } as const;
  subscription?.onEvent(event);
  expect(onEvent).toHaveBeenCalledExactlyOnceWith(event);
  stop();
});

it("等待 ACP 事件连接期间取消发送，不调用原生提交命令", async () => {
  let release!: () => void;
  const connected = new Promise<void>((resolve) => {
      release = resolve;
    }),
    invoke = vi.fn(async () => ({}));
  const client = new TauriCatalogClient({
    invoke: invoke as InvokeImplementation,
    connectEvents: () => connected,
  });
  const controller = new AbortController();
  const pending = client.startAcpTurn(
    "p",
    "t",
    "q",
    {} as import("@codexly/protocol").AgentTurnOptions,
    { signal: controller.signal },
  );
  controller.abort(new Error("用户取消"));
  release();
  await expect(pending).rejects.toThrow("用户取消");
  expect(invoke).not.toHaveBeenCalled();
});

it("ACP 新任务创建携带稳定幂等键且不初始化旧引擎", async () => {
  const invoke = vi.fn(async () => ({ id: "new" })),
    ensureRuntime = vi.fn(async () => undefined);
  const client = new TauriCatalogClient({
    invoke: invoke as InvokeImplementation,
    ensureRuntime,
    connectEvents: () => Promise.resolve(),
  });
  await client.createAcpTask("temporary", "claude", { idempotencyKey: "creation-key" });
  expect(ensureRuntime).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledWith("create_acp_task", {
    projectId: "temporary",
    engine: "claude",
    idempotencyKey: "creation-key",
  });
});

it("ACP 附件发送只提交应用引用元数据", async () => {
  const invoke = vi.fn(async () => ({}));
  const client = new TauriCatalogClient({
    invoke: invoke as InvokeImplementation,
    connectEvents: () => Promise.resolve(),
  });
  const input = {
    type: "prompt" as const,
    text: "file",
    skills: [],
    attachments: [
      {
        id: "history-1",
        kind: "text" as const,
        name: "a.txt",
        mediaType: "text/plain" as const,
        size: 5,
      },
    ],
  };
  await client.startAcpPrompt("p", "t", input, {} as import("@codexly/protocol").AgentTurnOptions);
  expect(invoke).toHaveBeenCalledWith(
    "acp_task_request",
    expect.objectContaining({ params: expect.objectContaining({ input }) }),
  );
});

it("ACP 队列保留应用附件引用与消息身份，不初始化旧运行时", async () => {
  const invoke = vi.fn(async () => ({})),
    ensureRuntime = vi.fn(async () => undefined);
  const client = new TauriCatalogClient({
    invoke: invoke as InvokeImplementation,
    ensureRuntime,
    connectEvents: () => Promise.resolve(),
  });
  const input = { type: "prompt" as const, text: "next", skills: [], attachments: [] };
  await client.addAcpQueuedSubmission("p", "t", input, "message");
  await client.listAcpQueuedSubmissions("p", "t");
  await client.updateAcpQueuedSubmission("p", "t", "q", input, "editing");
  await client.reorderAcpQueuedSubmissions("p", "t", ["q"]);
  await client.moveAcpQueuedSubmission("p", "t", "q", -1);
  await client.startAcpQueuedSubmission("p", "t", "q");
  await client.deleteAcpQueuedSubmission("p", "t", "q");
  expect(ensureRuntime).not.toHaveBeenCalled();
  expect(invoke.mock.calls).toEqual([
    [
      "acp_task_request",
      {
        projectId: "p",
        method: "queue.add",
        params: { taskId: "t", input, clientUserMessageId: "message" },
      },
    ],
    ["acp_task_request", { projectId: "p", method: "queue.list", params: { taskId: "t" } }],
    [
      "acp_task_request",
      {
        projectId: "p",
        method: "queue.update",
        params: { taskId: "t", queuedSubmissionId: "q", input, status: "editing" },
      },
    ],
    [
      "acp_task_request",
      {
        projectId: "p",
        method: "queue.reorder",
        params: { taskId: "t", queuedSubmissionIds: ["q"] },
      },
    ],
    [
      "acp_task_request",
      {
        projectId: "p",
        method: "queue.move",
        params: { taskId: "t", queuedSubmissionId: "q", offset: -1 },
      },
    ],
    [
      "acp_task_request",
      { projectId: "p", method: "queue.start", params: { taskId: "t", queuedSubmissionId: "q" } },
    ],
    [
      "acp_task_request",
      { projectId: "p", method: "queue.delete", params: { taskId: "t", queuedSubmissionId: "q" } },
    ],
  ]);
});

it("首发配置进入原生提交参数并保留 false 和幂等身份", async () => {
  const invoke = vi.fn(() => Promise.resolve({}));
  const client = new TauriCatalogClient({
    invoke: invoke as InvokeImplementation,
    ensureRuntime: vi.fn(),
  });
  const input = { type: "prompt" as const, text: "开始", attachments: [], skills: [] };
  await client.startConfiguredAcpPrompt("p", "t", input, "same", { enabled: false });
  expect(invoke).toHaveBeenCalledWith("acp_task_request", {
    projectId: "p",
    method: "prompt.start",
    params: { taskId: "t", input, idempotencyKey: "same", initialConfig: { enabled: false } },
  });
});

it("配置变更重试传递原提交恢复键，不复用旧发送入口", async () => {
  const invoke = vi.fn(() => Promise.resolve({}));
  const client = new TauriCatalogClient({
    invoke: invoke as InvokeImplementation,
    ensureRuntime: vi.fn(),
  });
  const input = { type: "prompt" as const, text: "重试", attachments: [], skills: [] };
  await client.startConfiguredAcpPrompt("p", "t", input, "next", { enabled: true }, "old");
  expect(invoke).toHaveBeenCalledWith("acp_task_request", {
    projectId: "p",
    method: "prompt.start",
    params: {
      taskId: "t",
      input,
      idempotencyKey: "next",
      initialConfig: { enabled: true },
      recoveryKey: "old",
    },
  });
});
