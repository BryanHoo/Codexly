import { afterEach, describe, expect, it, vi } from "vitest";
import * as acp from "@agentclientprotocol/sdk/unstable";
import { AcpConnection } from "./connection.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
});

function fixture(capabilities: acp.AgentCapabilities = { loadSession: true }) {
  const outbound = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
  const inbound = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
  const initialize = vi.fn<
    (
      context: acp.AgentRequestContext<acp.InitializeRequest>,
    ) => acp.InitializeResponse | Promise<acp.InitializeResponse>
  >((_context) => ({ protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: capabilities }));
  const create = vi.fn<
    (
      context: acp.AgentRequestContext<acp.NewSessionRequest>,
    ) => acp.NewSessionResponse | Promise<acp.NewSessionResponse>
  >(() => ({ sessionId: "native-session", configOptions: [] }));
  const load = vi.fn<
    (
      context: acp.AgentRequestContext<acp.LoadSessionRequest>,
    ) => acp.LoadSessionResponse | Promise<acp.LoadSessionResponse>
  >(async ({ params, client }: acp.AgentRequestContext<acp.LoadSessionRequest>) => {
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: "旧问题" } },
    });
    return { configOptions: [] };
  });
  const cancel = vi.fn();
  const app = acp
    .agent({ name: "test-agent" })
    .onRequest(acp.methods.agent.initialize, initialize)
    .onRequest(acp.methods.agent.session.new, create)
    .onRequest(acp.methods.agent.session.load, load)
    .onNotification(acp.methods.agent.session.cancel, cancel);
  const start = () => {
    const agent = app.connect({ readable: outbound.readable, writable: inbound.writable });
    cleanup.push(() => {
      agent.close();
    });
  };
  const stream = { writable: outbound.writable, readable: inbound.readable };
  return { app, stream, initialize, create, load, cancel, start };
}

async function connect(
  f: ReturnType<typeof fixture>,
  callbacks: Parameters<typeof AcpConnection.connect>[1] = {},
) {
  f.start();
  const connection = await AcpConnection.connect(f.stream, callbacks);
  cleanup.push(() => {
    connection.close();
  });
  return connection;
}

it("仅声明已实现的客户端能力，启用标准布尔配置但不声明终端认证", async () => {
  const f = fixture();
  await connect(f);
  expect(f.initialize.mock.calls[0]?.[0].params.clientCapabilities).toMatchObject({
    session: { configOptions: { boolean: {} } },
  });
  expect(
    f.initialize.mock.calls[0]?.[0].params.clientCapabilities?.auth?.terminal,
  ).not.toBeTruthy();
});

describe("共享 ACP 连接", () => {
  it("并发创建保留早于响应到达的命令，完整配置响应不丢命令或另一个待绑定会话", async () => {
    const f = fixture({ loadSession: true, sessionCapabilities: { close: {} } });
    const secondEntered = Promise.withResolvers<undefined>(),
      release = Promise.withResolvers<undefined>();
    f.create.mockImplementation(async ({ params, client }) => {
      const sessionId = params.cwd === "/a" ? "a" : "b";
      await client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: [{ name: `command-${sessionId}`, description: "命令" }],
        },
      });
      if (sessionId === "a") await secondEntered.promise;
      else {
        secondEntered.resolve(undefined);
        await release.promise;
      }
      return { sessionId, configOptions: [] };
    });
    f.app.onRequest(acp.methods.agent.session.close, () => ({}));
    const config: acp.SessionConfigOption[] = [
      { id: "fast", name: "加速", type: "boolean", currentValue: true },
    ];
    f.app.onRequest(acp.methods.agent.session.setConfigOption, () => ({ configOptions: config }));
    const onSessionState = vi.fn();
    const connection = await connect(f, { onSessionState });
    const a = connection.newSession({ cwd: "/a", mcpServers: [] }),
      b = connection.newSession({ cwd: "/b", mcpServers: [] });
    try {
      expect((await a).sessionId).toBe("a");
      expect(connection.readSessionState("b").availableCommands[0]?.name).toBe("command-b");
    } finally {
      release.resolve(undefined);
    }
    await b;
    expect(connection.readSessionState("a").availableCommands[0]?.name).toBe("command-a");
    expect(connection.readSessionState("b").availableCommands[0]?.name).toBe("command-b");
    await connection.setConfigOption("a", "fast", true);
    expect(connection.readSessionState("a")).toEqual({
      configOptions: config,
      availableCommands: [{ name: "command-a", description: "命令" }],
    });
    expect(onSessionState).toHaveBeenCalled();
    await connection.closeSession("a");
    expect(connection.readSessionState("a")).toEqual({ configOptions: [], availableCommands: [] });
    connection.close();
    expect(connection.readSessionState("b")).toEqual({ configOptions: [], availableCommands: [] });
  });

  it("历史重放中的命令及配置进入同一状态，加载失败清理未绑定元数据", async () => {
    const f = fixture();
    f.load.mockImplementation(async ({ params, client }) => {
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: [{ name: "review", description: "检查" }],
        },
      });
      if (params.sessionId === "missing") throw new acp.RequestError(-32002, "不存在");
      return {
        configOptions: [
          { id: "mode", name: "模式", type: "boolean" as const, currentValue: false },
        ],
      };
    });
    const connection = await connect(f);
    await connection.loadSession({ sessionId: "old", cwd: "/a", mcpServers: [] });
    expect(connection.readSessionState("old")).toMatchObject({
      configOptions: [{ currentValue: false }],
      availableCommands: [{ name: "review" }],
    });
    await expect(
      connection.loadSession({ sessionId: "missing", cwd: "/a", mcpServers: [] }),
    ).rejects.toThrow("不存在");
    expect(connection.readSessionState("missing").availableCommands).toEqual([]);
    expect(connection.readSessionState("old").availableCommands).toHaveLength(1);
  });

  it("使用稳定版本握手且不声明未实现的文件或终端能力", async () => {
    const f = fixture();
    const connection = await connect(f);
    expect(connection.initialization.protocolVersion).toBe(acp.PROTOCOL_VERSION);
    expect(f.initialize.mock.calls[0]?.[0].params.clientCapabilities).toMatchObject({
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    });
    expect((await connection.newSession({ cwd: "/workspace", mcpServers: [] })).sessionId).toBe(
      "native-session",
    );
  });

  it("用原生会话身份加载旧历史，失败不创建替代会话", async () => {
    const f = fixture();
    const updates: acp.SessionNotification[] = [];
    const connection = await connect(f, {
      onUpdate: (update) => {
        updates.push(update);
      },
    });
    await connection.loadSession({ sessionId: "old-native-id", cwd: "/workspace", mcpServers: [] });
    expect(updates[0]?.sessionId).toBe("old-native-id");
    expect(updates[0]?.update.sessionUpdate).toBe("user_message_chunk");
    expect(f.create).not.toHaveBeenCalled();
    f.load.mockRejectedValueOnce(new acp.RequestError(-32002, "历史不存在"));
    await expect(
      connection.loadSession({ sessionId: "missing", cwd: "/workspace", mcpServers: [] }),
    ).rejects.toThrow("历史不存在");
    expect(f.create).not.toHaveBeenCalled();
  });

  it("未协商历史加载时显式拒绝", async () => {
    const f = fixture({});
    const connection = await connect(f);
    await expect(
      connection.loadSession({ sessionId: "old", cwd: "/workspace", mcpServers: [] }),
    ).rejects.toThrow("session/load");
    expect(f.load).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });

  it("按序转发增量和权限选项，不自动批准", async () => {
    const f = fixture();
    const updates: string[] = [];
    const permission = vi.fn((request: acp.RequestPermissionRequest) => {
      const option = request.options[1];
      if (!option) throw new Error("测试缺少拒绝选项");
      return Promise.resolve({
        outcome: { outcome: "selected" as const, optionId: option.optionId },
      });
    });
    f.app.onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "第一段" } },
      });
      const result = await client.request(acp.methods.client.session.requestPermission, {
        sessionId: params.sessionId,
        toolCall: { toolCallId: "tool", title: "修改文件" },
        options: [
          { kind: "allow_once", optionId: "allow", name: "允许" },
          { kind: "reject_once", optionId: "reject", name: "拒绝" },
        ],
      });
      expect(result.outcome).toEqual({ outcome: "selected", optionId: "reject" });
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "第二段" } },
      });
      return { stopReason: "end_turn" };
    });
    const connection = await connect(f, {
      requestPermission: permission,
      onUpdate: ({ update }) => {
        if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text")
          updates.push(update.content.text);
      },
    });
    await connection.newSession({ cwd: "/workspace", mcpServers: [] });
    expect(
      await connection.prompt({
        sessionId: "native-session",
        prompt: [{ type: "text", text: "你好" }],
      }),
    ).toEqual({ stopReason: "end_turn" });
    expect(updates).toEqual(["第一段", "第二段"]);
    expect(permission).toHaveBeenCalledOnce();
  });

  it("缺少权限处理器时取消请求", async () => {
    const f = fixture();
    f.app.onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
      expect(
        await client.request(acp.methods.client.session.requestPermission, {
          sessionId: params.sessionId,
          toolCall: { toolCallId: "t" },
          options: [],
        }),
      ).toEqual({ outcome: { outcome: "cancelled" } });
      return { stopReason: "end_turn" };
    });
    const connection = await connect(f);
    await connection.newSession({ cwd: "/workspace", mcpServers: [] });
    await connection.prompt({ sessionId: "native-session", prompt: [] });
  });

  it("同会话拒绝重叠 prompt，cancel 使用通知且保留最终结果", async () => {
    const f = fixture();
    let finish!: (value: acp.PromptResponse) => void;
    const started = Promise.withResolvers<undefined>();
    f.app.onRequest(acp.methods.agent.session.prompt, () => {
      started.resolve(undefined);
      return new Promise<acp.PromptResponse>((resolve) => {
        finish = resolve;
      });
    });
    f.cancel.mockImplementation(() => {
      finish({ stopReason: "cancelled" });
    });
    const connection = await connect(f);
    await connection.newSession({ cwd: "/workspace", mcpServers: [] });
    const result = connection.prompt({ sessionId: "native-session", prompt: [] });
    await started.promise;
    await expect(connection.prompt({ sessionId: "native-session", prompt: [] })).rejects.toThrow(
      "进行中",
    );
    await connection.cancel("native-session");
    expect(await result).toEqual({ stopReason: "cancelled" });
  });

  it("连接关闭使未完成请求失败且可重复关闭", async () => {
    const f = fixture();
    const started = Promise.withResolvers<undefined>();
    f.app.onRequest(
      acp.methods.agent.session.prompt,
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          started.resolve(undefined);
          signal.addEventListener(
            "abort",
            () => {
              reject(new Error("关闭"));
            },
            { once: true },
          );
        }),
    );
    const connection = await connect(f);
    await connection.newSession({ cwd: "/workspace", mcpServers: [] });
    const result = connection.prompt({ sessionId: "native-session", prompt: [] });
    const rejected = expect(result).rejects.toThrow();
    await started.promise;
    connection.close();
    connection.close();
    await rejected;
    await connection.closed;
  });
  it("拒绝不支持的协议版本并关闭连接", async () => {
    const f = fixture();
    f.initialize.mockReturnValueOnce({ protocolVersion: 999, agentCapabilities: {} });
    f.start();
    await expect(AcpConnection.connect(f.stream)).rejects.toThrow("协议版本");
  });

  it("握手超时会关闭连接，避免遗留永不完成的等待", async () => {
    const f = fixture();
    f.initialize.mockImplementationOnce(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              reject(new Error("已关闭"));
            },
            { once: true },
          );
        }),
    );
    f.start();
    await expect(AcpConnection.connect(f.stream, {}, { handshakeTimeoutMs: 20 })).rejects.toThrow(
      "握手超时",
    );
  });

  it("设置选项保留 agent 返回的完整配置，支持布尔值", async () => {
    const f = fixture();
    const config: acp.SessionConfigOption[] = [
      { id: "fast", name: "加速", type: "boolean", currentValue: true },
    ];
    const set = vi.fn(({ params }: acp.AgentRequestContext<acp.SetSessionConfigOptionRequest>) => {
      expect(params).toMatchObject({
        sessionId: "native-session",
        configId: "fast",
        type: "boolean",
        value: true,
      });
      return { configOptions: config };
    });
    f.app.onRequest(acp.methods.agent.session.setConfigOption, set);
    const connection = await connect(f);
    await connection.newSession({ cwd: "/workspace", mcpServers: [] });
    expect(await connection.setConfigOption("native-session", "fast", true)).toEqual({
      configOptions: config,
    });
  });
  it("历史加载返回前等待异步投影完成，并按通知顺序交付", async () => {
    const f = fixture();
    const gate = Promise.withResolvers<undefined>();
    const entered = Promise.withResolvers<undefined>();
    const order: string[] = [];
    const connection = await connect(f, {
      onUpdate: async () => {
        entered.resolve(undefined);
        await gate.promise;
        order.push("历史落盘");
      },
    });
    const loading = connection
      .loadSession({ sessionId: "old", cwd: "/workspace", mcpServers: [] })
      .then(() => {
        order.push("加载完成");
      });
    await entered.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual([]);
    gate.resolve(undefined);
    await loading;
    expect(order).toEqual(["历史落盘", "加载完成"]);
  });
  it("仅在 agent 声明能力时关闭单个会话，并移除本地可发送状态", async () => {
    const f = fixture({ loadSession: true, sessionCapabilities: { close: {} } });
    const close = vi.fn(() => ({}));
    f.app.onRequest(acp.methods.agent.session.close, close);
    const connection = await connect(f);
    await connection.newSession({ cwd: "/workspace", mcpServers: [] });
    await connection.closeSession("native-session");
    expect(close).toHaveBeenCalledOnce();
    await expect(connection.prompt({ sessionId: "native-session", prompt: [] })).rejects.toThrow(
      "尚未加载",
    );
    const unsupported = await connect(fixture({}));
    await expect(unsupported.closeSession("old")).rejects.toThrow("session/close");
  });
});
