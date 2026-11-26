import { expect, it, vi } from "vitest";
import { TauriNativeClient, type InvokeImplementation } from "./native-client.js";
import { TauriSidebarClient } from "./sidebar-client.js";

function gate() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const legacyCommands = [
  "read_thread_memory",
  "compress_history",
  "get_global_instructions",
  "save_global_instructions",
  "get_memory_settings",
  "update_memory_settings",
  "reset_memories",
  "list_models",
  "get_provider_connection",
  "start_official_provider_login",
  "cancel_provider_login",
  "configure_custom_provider",
  "logout_provider",
  "get_global_settings",
  "update_global_settings",
  "get_project_defaults",
  "update_project_defaults",
  "list_skills",
  "list_installed_skills",
  "list_configured_mcp_servers",
  "open_skill_directory",
  "set_skill_enabled",
  "set_mcp_server_enabled",
  "reconcile_official_plugins",
  "list_official_plugins",
  "get_official_plugin",
  "install_official_plugin",
  "uninstall_official_plugin",
  "list_mcp_servers",
  "retry_mcp_servers",
  "claude_engine_request",
  "upload_feedback",
];

class Transport extends TauriNativeClient {
  mode: "acp" | "legacy" = "acp";
  readonly checked = vi.fn(() => Promise.resolve(this.mode));
  protected override applicationRuntime() {
    return this.checked();
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
}

it.each(legacyCommands)("ACP 在全部原生入口拒绝旧全局能力 %s", async (command) => {
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
    await expect(call()).rejects.toMatchObject({
      code: "ACP_LEGACY_GLOBAL_COMMAND_REJECTED",
      command,
    });
  }
  expect(invoke).not.toHaveBeenCalled();
  expect(ensureRuntime).not.toHaveBeenCalled();
  expect(connectEvents).not.toHaveBeenCalled();
});

it("旧模式保留所有命令和参数，ACP 本地与专用端口不增加能力查询", async () => {
  const invoke = vi.fn().mockResolvedValue(null);
  const client = new Transport({ invoke: invoke as InvokeImplementation });
  client.mode = "legacy";
  for (const command of legacyCommands) await client.direct(command);
  expect(invoke.mock.calls).toEqual(legacyCommands.map((command) => [command, {}]));
  invoke.mockClear();
  client.checked.mockClear();
  client.mode = "acp";
  const allowed = [
    "get_app_info",
    "export_diagnostics",
    "application_preferences_request",
    "acp_agent_request",
    "read_acp_agent",
    "acp_plan_request",
    "get_project_git_status",
  ];
  for (const command of allowed) await client.direct(command);
  expect(invoke.mock.calls.map((call) => call[0])).toEqual(allowed);
  expect(client.checked).not.toHaveBeenCalled();
});

it("初始化等待时切换到 ACP，不再发送旧模型查询", async () => {
  const entered = gate();
  const ready = gate();
  const invoke = vi.fn();
  const client = new Transport({
    invoke: invoke as InvokeImplementation,
    ensureRuntime: () => {
      entered.resolve();
      return ready.promise;
    },
  });
  client.mode = "legacy";
  const sending = client.send("list_models");
  await entered.promise;
  client.mode = "acp";
  ready.resolve();
  await expect(sending).rejects.toMatchObject({ code: "ACP_LEGACY_GLOBAL_COMMAND_REJECTED" });
  expect(invoke).not.toHaveBeenCalled();
});

class Client extends TauriSidebarClient {
  mode: "acp" | "legacy" = "acp";
  override async getCapabilities() {
    const capabilities = await super.getCapabilities();
    return this.mode === "acp" ? { ...capabilities, runtime: "acp" as const } : capabilities;
  }
}

const publicCalls = [
  (client: Client) => client.listModels(),
  (client: Client) => client.getEngineProfile("codex"),
  (client: Client) => client.getEngineProfile("claude"),
  (client: Client) => client.getClaudeSettings(),
  (client: Client) => client.getGlobalSettings(),
  (client: Client) => client.getGlobalSettings({ engine: "claude" }),
  (client: Client) => client.logoutProvider(),
  (client: Client) => client.setSkillEnabled("/skills/SKILL.md", true),
  (client: Client) => client.getMemorySettings(),
  (client: Client) => client.getGlobalInstructions(),
];
it.each(publicCalls.map((call, index) => [index, call] as const))(
  "公共旧全局方法 %i 在 ACP 不执行 IPC",
  async (_index, call) => {
    const invoke = vi.fn();
    const ensureRuntime = vi.fn();
    const connectEvents = vi.fn();
    const client = new Client({
      invoke: invoke as InvokeImplementation,
      ensureRuntime,
      connectEvents,
    });
    await expect(call(client)).rejects.toMatchObject({
      code: "ACP_LEGACY_GLOBAL_COMMAND_REJECTED",
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(ensureRuntime).not.toHaveBeenCalled();
    expect(connectEvents).not.toHaveBeenCalled();
  },
);

it("ACP 健康仅等待应用事件通道，不启动模型或伪造 agent 检查", async () => {
  const ensureRuntime = vi.fn();
  const invoke = vi.fn();
  const connectEvents = vi.fn().mockResolvedValue({ status: "idle", lastSeq: 0, provider: null });
  const client = new Client({
    invoke: invoke as InvokeImplementation,
    ensureRuntime,
    connectEvents,
  });
  await expect(client.getHealth()).resolves.toEqual({ status: "ok", version: 1 });
  expect(connectEvents).toHaveBeenCalledOnce();
  expect(ensureRuntime).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
});

it("旧健康检查继续确保原运行时就绪", async () => {
  const ensureRuntime = vi.fn();
  const connectEvents = vi.fn();
  const client = new Client({ ensureRuntime, connectEvents });
  client.mode = "legacy";
  await expect(client.getHealth()).resolves.toEqual({ status: "ok", version: 1 });
  expect(ensureRuntime).toHaveBeenCalledOnce();
  expect(connectEvents).not.toHaveBeenCalled();
});

it("ACP 通道故障保留真实错误，不报告健康或回退旧运行时", async () => {
  const ensureRuntime = vi.fn();
  const client = new Client({
    ensureRuntime,
    connectEvents: () => Promise.reject(new Error("通道故障")),
  });
  await expect(client.getHealth()).rejects.toThrow("通道故障");
  expect(ensureRuntime).not.toHaveBeenCalled();
});

it("健康读取预先取消时不握手，握手期间取消也不返回成功", async () => {
  const ready = gate();
  const ensureRuntime = vi.fn();
  const connectEvents = vi.fn(() => ready.promise);
  const client = new Client({ ensureRuntime, connectEvents });
  const controller = new AbortController();
  controller.abort(new Error("取消健康"));
  await expect(client.getHealth({ signal: controller.signal })).rejects.toThrow("取消健康");
  expect(connectEvents).not.toHaveBeenCalled();
  const next = new AbortController();
  const reading = client.getHealth({ signal: next.signal });
  await vi.waitFor(() => {
    expect(connectEvents).toHaveBeenCalledOnce();
  });
  next.abort(new Error("取消等待"));
  ready.resolve();
  await expect(reading).rejects.toThrow("取消等待");
  expect(ensureRuntime).not.toHaveBeenCalled();
});

it("健康读取在能力查询期间取消后不能再握手", async () => {
  const ensureRuntime = vi.fn();
  const connectEvents = vi.fn();
  const client = new Client({ ensureRuntime, connectEvents });
  const capabilities = await client.getCapabilities();
  const ready = gate();
  const checked = vi.spyOn(client, "getCapabilities").mockImplementation(async () => {
    await ready.promise;
    return capabilities;
  });
  const controller = new AbortController();
  const reading = client.getHealth({ signal: controller.signal });
  expect(checked).toHaveBeenCalledOnce();
  controller.abort(new Error("取消能力查询"));
  ready.resolve();
  await expect(reading).rejects.toThrow("取消能力查询");
  expect(connectEvents).not.toHaveBeenCalled();
  expect(ensureRuntime).not.toHaveBeenCalled();
});
