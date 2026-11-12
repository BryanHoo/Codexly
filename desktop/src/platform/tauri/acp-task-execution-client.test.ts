import { expect, it, vi } from "vitest";
import { TauriNativeClient, type InvokeImplementation } from "./native-client.js";
import { TauriSidebarClient } from "./sidebar-client.js";

const legacyCommands = [
  "start_task",
  "start_turn",
  "submit_prompt",
  "submit_review",
  "steer_turn",
  "stop_task_session",
  "get_task_settings",
  "update_task_settings",
  "update_task_goal",
  "clear_task_goal",
  "compact_task",
  "fork_task",
  "list_background_terminals",
  "terminate_background_terminal",
  "list_queued_submissions",
  "add_queued_submission",
  "delete_queued_submission",
  "move_queued_submission",
  "start_queued_submission",
  "read_task",
  "retain_task_subscription",
  "release_task_subscription",
  "pin_task",
  "rename_task",
  "archive_task",
  "unarchive_task",
  "delete_task",
  "interrupt_turn",
  "resolve_pending_request",
];

class Transport extends TauriNativeClient {
  mode: "acp" | "legacy" = "acp";
  protected override applicationRuntime() {
    return Promise.resolve(this.mode);
  }
  send(command: string) {
    return this.call(command, {});
  }
  direct(command: string) {
    return this.invokeCommand(command, {});
  }
  cancellable(command: string, signal: AbortSignal) {
    return this.callCancellable(command, {}, signal);
  }
  raw(command: string) {
    return this.callRaw(command, new Uint8Array(), {});
  }
  approval() {
    return this.call("resolve_pending_request", { acp: true, request: { taskId: "t" } });
  }
}

it.each(legacyCommands)("ACP 拒绝旧任务命令 %s，初始化和原生命令均不执行", async (command) => {
  const invoke = vi.fn().mockResolvedValue(null);
  const ensureRuntime = vi.fn();
  const connectEvents = vi.fn();
  const client = new Transport({
    invoke: invoke as InvokeImplementation,
    ensureRuntime,
    connectEvents,
  });
  for (const call of [
    () => client.send(command),
    () => client.direct(command),
    () => client.cancellable(command, new AbortController().signal),
    () => client.raw(command),
  ]) {
    await expect(call()).rejects.toMatchObject({ code: "ACP_LEGACY_TASK_COMMAND_REJECTED" });
  }
  expect(invoke).not.toHaveBeenCalled();
  expect(ensureRuntime).not.toHaveBeenCalled();
  expect(connectEvents).not.toHaveBeenCalled();
});

it("连接期间切到 ACP 时，迟到旧命令仍不能发出", async () => {
  let connected = () => undefined as void;
  const connection = new Promise<void>((resolve) => {
    connected = resolve;
  });
  const invoke = vi.fn().mockResolvedValue(null);
  const connectEvents = vi.fn(() => connection);
  const client = new Transport({ invoke: invoke as InvokeImplementation, connectEvents });
  client.mode = "legacy";
  const sending = client.send("start_task");
  await vi.waitFor(() => {
    expect(connectEvents).toHaveBeenCalledOnce();
  });
  client.mode = "acp";
  connected();
  await expect(sending).rejects.toMatchObject({ code: "ACP_LEGACY_TASK_COMMAND_REJECTED" });
  expect(invoke).not.toHaveBeenCalled();
});

it("legacy 继续执行原命令和参数，不限制本地与 ACP 专用端口", async () => {
  const invoke = vi.fn().mockResolvedValue(null);
  const client = new Transport({
    invoke: invoke as InvokeImplementation,
    ensureRuntime: async () => undefined,
    connectEvents: async () => undefined,
  });
  client.mode = "legacy";
  for (const command of legacyCommands) await client.direct(command);
  client.mode = "acp";
  for (const command of [
    "application_preferences_request",
    "create_acp_task",
    "acp_task_request",
    "list_tasks",
    "get_project_git_status",
  ])
    await client.send(command);
  expect(invoke.mock.calls.map((call) => call[0])).toEqual([
    ...legacyCommands,
    "application_preferences_request",
    "create_acp_task",
    "acp_task_request",
    "list_tasks",
    "get_project_git_status",
  ]);
});

it("ACP 标记的审批不被旧任务命令边界误挡", async () => {
  const invoke = vi.fn().mockResolvedValue(null);
  const ensureRuntime = vi.fn();
  const client = new Transport({
    invoke: invoke as InvokeImplementation,
    ensureRuntime,
    connectEvents: async () => undefined,
  });
  await client.approval();
  expect(invoke).toHaveBeenCalledExactlyOnceWith("resolve_pending_request", {
    acp: true,
    request: { taskId: "t" },
  });
  expect(ensureRuntime).not.toHaveBeenCalled();
});

it("运行时校验期间取消后，即使命令可执行也不发送", async () => {
  let checked = () => undefined as void;
  const checking = new Promise<"legacy">((resolve) => {
    checked = () => resolve("legacy");
  });
  const invoke = vi.fn().mockResolvedValue(null);
  const connectEvents = vi.fn();
  const client = new Transport({ invoke: invoke as InvokeImplementation, connectEvents });
  vi.spyOn(
    client as unknown as { applicationRuntime(): Promise<"legacy"> },
    "applicationRuntime",
  ).mockReturnValue(checking);
  const controller = new AbortController();
  const sending = client.cancellable("read_task", controller.signal);
  controller.abort(new Error("取消检查"));
  checked();
  await expect(sending).rejects.toThrow("取消检查");
  expect(invoke).not.toHaveBeenCalled();
  expect(connectEvents).not.toHaveBeenCalled();
});

it("已装上取消监听后，发送前的第二次校验也不能让请求晚于取消发出", async () => {
  let checked = () => undefined as void;
  const checking = new Promise<"legacy">((resolve) => {
    checked = () => resolve("legacy");
  });
  const invoke = vi.fn().mockResolvedValue(null);
  const client = new Transport({
    invoke: invoke as InvokeImplementation,
    connectEvents: async () => undefined,
  });
  const boundary = vi
    .spyOn(client as unknown as { applicationRuntime(): Promise<"legacy"> }, "applicationRuntime")
    .mockResolvedValueOnce("legacy")
    .mockReturnValueOnce(checking);
  const controller = new AbortController();
  const sending = client.cancellable("read_task", controller.signal);
  await vi.waitFor(() => {
    expect(boundary).toHaveBeenCalledTimes(2);
  });
  controller.abort(new Error("取消第二次检查"));
  checked();
  await expect(sending).rejects.toThrow("取消第二次检查");
  expect(invoke.mock.calls.map((call) => call[0])).toEqual(["cancel_native_request"]);
});

it("取消读取兼容仅有 getRandomValues 的旧 WebKit", async () => {
  const invoke = vi.fn().mockResolvedValue({ snapshot: {} });
  const client = new Transport({
    invoke: invoke as InvokeImplementation,
    connectEvents: async () => undefined,
  });
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  try {
    await expect(
      client.cancellable("acp_task_request", new AbortController().signal),
    ).resolves.toEqual({ snapshot: {} });
  } finally {
    vi.unstubAllGlobals();
  }
});

class AcpClient extends TauriSidebarClient {
  protected override applicationRuntime() {
    return Promise.resolve("acp" as const);
  }
}

it("公共中断在 ACP 保留任务与回合身份，只等待共享端口确认", async () => {
  const invoke = vi.fn().mockResolvedValue(null);
  const ensureRuntime = vi.fn();
  const client = new AcpClient({
    invoke: invoke as InvokeImplementation,
    ensureRuntime,
    connectEvents: async () => undefined,
  });
  expect(await client.interruptTurn("p", "t", "turn")).toEqual({
    status: "interrupting",
    taskId: "t",
    turnId: "turn",
  });
  expect(invoke).toHaveBeenCalledExactlyOnceWith("acp_task_request", {
    projectId: "p",
    method: "turn.interrupt",
    params: { taskId: "t", turnId: "turn" },
  });
  expect(ensureRuntime).not.toHaveBeenCalled();
});

it("ACP 中断失败不回退旧命令，连接期间取消也不能再发送", async () => {
  const invoke = vi.fn().mockRejectedValue(new Error("共享宿主拒绝"));
  const client = new AcpClient({
    invoke: invoke as InvokeImplementation,
    connectEvents: async () => undefined,
  });
  await expect(client.interruptTurn("p", "t", "turn")).rejects.toThrow("共享宿主拒绝");
  expect(invoke.mock.calls[0]?.[0]).toBe("acp_task_request");
  let connected = () => undefined as void;
  const connection = new Promise<void>((resolve) => {
    connected = resolve;
  });
  const connectEvents = vi.fn(() => connection);
  const cancelled = new AcpClient({ invoke: invoke as InvokeImplementation, connectEvents });
  const controller = new AbortController();
  const sending = cancelled.interruptTurn("p", "t", "turn", { signal: controller.signal });
  await vi.waitFor(() => {
    expect(connectEvents).toHaveBeenCalledOnce();
  });
  controller.abort(new Error("取消发送"));
  connected();
  await expect(sending).rejects.toThrow("取消发送");
  expect(invoke).toHaveBeenCalledOnce();
});
