import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterEach, it, expect, vi } from "vitest";
import * as acp from "@agentclientprotocol/sdk/unstable";
import type {
  LocalTask,
  LocalCatalogStore,
  CatalogOperations,
  AgentProviderEvent,
} from "@codexly/core";
import type { AgentTurnOptions } from "@codexly/protocol";
import { AcpConnection } from "./connection.js";
import { AcpHistory } from "./history.js";
import { AcpAgentProvider } from "./provider.js";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function fixture(
  engine: "codex" | "claude",
  handler?: (context: acp.AgentRequestContext<acp.PromptRequest>) => Promise<acp.PromptResponse>,
  initializeSession?: (
    connection: AcpConnection,
    sessionId: string,
    options: acp.SessionConfigOption[],
  ) => Promise<acp.SessionConfigOption[]>,
) {
  const directory = await mkdtemp(join(tmpdir(), "acp-provider-"));
  const tasks = new Map<string, LocalTask>();
  const catalog = vi.fn((op: string, input: LocalTask) => {
    if (op === "task.read") return tasks.get(input.id) ?? null;
    if (op === "task.put") {
      tasks.set(input.id, input);
      return input;
    }
    if (op === "task.patch") {
      const old = tasks.get(input.id);
      if (!old) throw new Error("不存在");
      const next = { ...old, ...input };
      tasks.set(input.id, next);
      return next;
    }
    throw new Error(op);
  });
  const created = vi.fn<
    (
      context: acp.AgentRequestContext<acp.NewSessionRequest>,
    ) => acp.NewSessionResponse | Promise<acp.NewSessionResponse>
  >(() => ({
    sessionId: "native",
    configOptions: [],
  }));
  const loaded = vi.fn(
    async ({ params, client }: acp.AgentRequestContext<acp.LoadSessionRequest>) => {
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "user_message_chunk",
          messageId: "old-user",
          content: { type: "text", text: "旧问题" },
        },
      });
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "old-reply",
          content: { type: "text", text: "旧回答" },
        },
      });
      return {};
    },
  );
  const app = acp
    .agent({ name: "test" })
    .onRequest(acp.methods.agent.initialize, () => ({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: { close: {} } },
    }))
    .onRequest(acp.methods.agent.session.new, created)
    .onRequest(acp.methods.agent.session.close, () => ({}))
    .onRequest(acp.methods.agent.session.load, loaded)
    .onRequest(acp.methods.agent.session.prompt, async (context) => {
      if (handler) return handler(context);
      const { params, client } = context;
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "ACP 回答" },
        },
      });
      return { stopReason: "end_turn" };
    });
  const history = new AcpHistory(directory);
  const provider = new AcpAgentProvider(
    engine,
    { id: "project", kind: "project", rootPath: directory, runtimeWorkspaceRoots: [directory] },
    {
      catalog: <K extends keyof CatalogOperations>(
        operation: K,
        payload: CatalogOperations[K][0],
      ) =>
        Promise.resolve(
          catalog(operation, payload as unknown as LocalTask) as CatalogOperations[K][1],
        ),
    } satisfies LocalCatalogStore,
    history,
    async (callbacks) => {
      const a = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
      const b = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
      const agent = app.connect({ readable: a.readable, writable: b.writable });
      cleanup.push(() => {
        agent.close();
        return Promise.resolve();
      });
      return AcpConnection.connect({ readable: b.readable, writable: a.writable }, callbacks);
    },
    initializeSession,
  );
  cleanup.push(async () => {
    await provider.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { provider, tasks, created, loaded, history, catalog, app };
}
const input = { text: "问题", files: [], images: [], skills: [], textAttachments: [] };
it("完整ACP会话状态包含提前到达的命令，配置变更更新事件和历史快照", async () => {
  const f = await fixture("claude");
  const config: acp.SessionConfigOption[] = [
    { id: "mode", name: "模式", type: "boolean", currentValue: false },
  ];
  f.created.mockImplementationOnce(async ({ client }) => {
    await client.notify(acp.methods.client.session.update, {
      sessionId: "native",
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [{ name: "review", description: "检查", input: { hint: "范围" } }],
      },
    });
    return { sessionId: "native", configOptions: config };
  });
  const updated: acp.SessionConfigOption[] = [
    { id: "mode", name: "模式", type: "boolean", currentValue: true },
  ];
  f.app.onRequest(acp.methods.agent.session.setConfigOption, () => ({ configOptions: updated }));
  const events: AgentProviderEvent[] = [];
  f.provider.subscribeEvents((event) => {
    events.push(event);
  });
  const task = await f.provider.startTask();
  const state = await f.provider.readSessionState(task.id);
  expect(state).toEqual({
    configOptions: config,
    availableCommands: [{ name: "review", description: "检查", input: { hint: "范围" } }],
  });
  await f.provider.setSessionConfiguration(task.id, "mode", true);
  expect(events.findLast((event) => event.type === "acp.session.updated")).toMatchObject({
    taskId: task.id,
    payload: { state: { configOptions: updated, availableCommands: state.availableCommands } },
  });
  expect((await f.provider.readTask(task.id)).acpSession).toEqual({
    configOptions: updated,
    availableCommands: state.availableCommands,
  });
  expect(f.created).toHaveBeenCalledOnce();
});
it("历史读取结束时同步交付最新快照给 checkpoint 捕获器", async () => {
  const f = await fixture("codex");
  const task = await f.provider.startTask();
  const capture = vi.fn();
  const snapshot = await f.provider.readTask(task.id, {
    snapshotRead: { prepare: (_key, read) => read(), capture },
  });
  expect(capture).toHaveBeenCalledExactlyOnceWith(snapshot);
});
it("新会话应用默认值失败后重试原绑定，已有历史会话不套用全局默认值", async () => {
  const initialize = vi.fn(
    (_connection: AcpConnection, _id: string, options: acp.SessionConfigOption[]) =>
      Promise.resolve(options),
  );
  initialize.mockRejectedValueOnce(new Error("默认值失败"));
  const f = await fixture("codex", undefined, initialize);
  const task = await f.provider.startTask();
  await expect(f.provider.readSessionConfiguration(task.id)).rejects.toThrow("默认值失败");
  await expect(f.provider.readSessionConfiguration(task.id)).resolves.toEqual([]);
  expect(f.created).toHaveBeenCalledOnce();
  expect(initialize).toHaveBeenCalledTimes(2);
  const old = await f.provider.startTask();
  const stored = f.tasks.get(old.id);
  if (!stored) throw new Error("缺少测试任务");
  f.tasks.set(old.id, { ...stored, sessionId: "old" });
  await f.provider.readSessionConfiguration(old.id);
  expect(initialize).toHaveBeenCalledTimes(2);
});
it.each(["codex", "claude"] as const)(
  "%s 通过同一 ACP Provider 新建、流式输出并保存回合",
  async (engine) => {
    const f = await fixture(engine);
    const events: AgentProviderEvent[] = [];
    f.provider.subscribeEvents((e) => {
      events.push(e);
    });
    const task = await f.provider.startTask();
    expect(f.created).not.toHaveBeenCalled();
    const turn = await f.provider.startTurn(task.id, input, {} as AgentTurnOptions);
    expect(turn.status).toBe("running");
    await expect.poll(() => events.some((e) => e.type === "turn.completed")).toBe(true);
    const snapshot = await f.provider.readTask(task.id);
    expect(
      snapshot.turns.at(-1)?.items.some((i) => i.type === "message" && i.text === "ACP 回答"),
    ).toBe(true);
    expect(f.tasks.get(task.id)?.sessionId).toBe("native");
    expect(f.created).toHaveBeenCalledOnce();
  },
);
it("旧任务通过原生 ID 重放历史，失败不替换绑定或创建会话", async () => {
  const f = await fixture("claude");
  f.tasks.set("old", {
    id: "old",
    provider: "claude",
    sessionId: "old-native",
    projectId: "project",
    title: "旧任务",
    cwd: "/workspace",
    pinned: false,
    archived: false,
    status: "idle",
    updatedAt: 1,
  });
  expect((await f.provider.readTask("old")).turns[0]?.items).toEqual(
    expect.arrayContaining([expect.objectContaining({ text: "旧回答" })]),
  );
  expect(f.loaded.mock.calls[0]?.[0].params.sessionId).toBe("old-native");
  expect(f.created).not.toHaveBeenCalled();
  const old = f.tasks.get("old");
  if (!old) throw new Error("旧任务夹具缺失");
  f.tasks.set("bad", { ...old, id: "bad", sessionId: "missing" });
  f.loaded.mockRejectedValueOnce(new acp.RequestError(-32002, "历史不存在"));
  await expect(f.provider.readTask("bad")).rejects.toThrow("历史不存在");
  expect(f.tasks.get("bad")?.sessionId).toBe("missing");
  expect(f.created).not.toHaveBeenCalled();
});

it("关闭等待正在提交的历史，避免宿主退出丢失终态", async () => {
  const f = await fixture("codex");
  const entered = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<undefined>();
  vi.spyOn(f.history, "append").mockImplementation(async () => {
    entered.resolve(undefined);
    await gate.promise;
  });
  const task = await f.provider.startTask();
  await f.provider.startTurn(task.id, input, {} as AgentTurnOptions);
  await entered.promise;
  let closed = false;
  const closing = f.provider.close().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(closed).toBe(false);
  gate.resolve(undefined);
  await closing;
});

it("会话绑定写入失败后重试保留同一原生会话，确认绑定前不提交 prompt", async () => {
  const f = await fixture("codex");
  const original = f.catalog.getMockImplementation();
  if (!original) throw new Error("夹具缺少目录实现");
  let failed = false;
  f.catalog.mockImplementation((op, value) => {
    if (op === "task.patch" && value.sessionId && !failed) {
      failed = true;
      throw new Error("绑定写入失败");
    }
    return original(op, value);
  });
  const task = await f.provider.startTask();
  await expect(f.provider.startTurn(task.id, input, {} as AgentTurnOptions)).rejects.toThrow(
    "绑定写入失败",
  );
  expect(f.tasks.get(task.id)?.sessionId).toBeNull();
  await f.provider.startTurn(task.id, input, {} as AgentTurnOptions);
  expect(f.tasks.get(task.id)?.sessionId).toBe("native");
  expect(f.created).toHaveBeenCalledOnce();
});

it("ACP 权限经应用快照和 resolution 往返，原始 ID 不改写", async () => {
  const outcome = Promise.withResolvers<acp.RequestPermissionResponse>();
  const f = await fixture("codex", async ({ params, client }) => {
    const result = await client.request(acp.methods.client.session.requestPermission, {
      sessionId: params.sessionId,
      toolCall: { toolCallId: "tool", title: "写入" },
      options: [{ optionId: "once", name: "允许一次", kind: "allow_once" }],
    });
    outcome.resolve(result);
    return { stopReason: "end_turn" };
  });
  const events: AgentProviderEvent[] = [];
  f.provider.subscribeEvents((event) => {
    events.push(event);
  });
  const task = await f.provider.startTask();
  await f.provider.startTurn(task.id, input, {} as AgentTurnOptions);
  await expect
    .poll(() => events.some((e) => e.type === "pending_request.created"), { timeout: 500 })
    .toBe(true);
  const request = (await f.provider.readTask(task.id)).pendingRequests[0];
  if (request?.type !== "tool_approval") throw new Error("审批缺失");
  await f.provider.resolvePendingRequest({
    ...request,
    resolution: { decision: "allow", optionId: "once" },
  });
  expect(await outcome.promise).toEqual({ outcome: { outcome: "selected", optionId: "once" } });
});

it("文件附件通过真实 ACP prompt 发送稳定资源链接", async () => {
  const prompt = Promise.withResolvers<acp.ContentBlock[]>();
  const f = await fixture("claude", ({ params }) => {
    prompt.resolve(params.prompt);
    return Promise.resolve({ stopReason: "end_turn" });
  });
  const path = join(f.history.directory, "upload.txt");
  await writeFile(path, "上传内容");
  const task = await f.provider.startTask();
  await f.provider.startTurn(
    task.id,
    { ...input, files: [{ path, name: "上传.txt", mediaType: "text/plain" }] },
    {} as AgentTurnOptions,
  );
  const content = await prompt.promise;
  const file = content.find((c) => c.type === "resource_link");
  if (!file) throw new Error("没有资源链接");
  await rm(path);
  expect(await readFile(fileURLToPath(file.uri), "utf8")).toBe("上传内容");
});

it("辅助会话不进入目录或磁盘历史，退订关闭会话并清理引用", async () => {
  const f = await fixture("codex");
  const task = await f.provider.startTask({ ephemeral: true });
  expect(f.tasks.has(task.id)).toBe(false);
  await f.provider.startTurn(task.id, input, {} as AgentTurnOptions);
  await expect.poll(async () => (await f.provider.readTask(task.id)).status).toBe("idle");
  expect((await f.history.read(task.id)).turns).toEqual([]);
  expect(await f.provider.unsubscribeTask(task.id)).toBe("unsubscribed");
  await expect(f.provider.readTask(task.id)).rejects.toThrow("任务");
});

it("辅助生成直接返回 ACP 回答，不创建用户任务；预先取消不启动 agent", async () => {
  const f = await fixture("claude");
  const aborted = new AbortController();
  aborted.abort(new Error("取消"));
  await expect(f.provider.generateText("优化正文", undefined, aborted.signal)).rejects.toThrow(
    "取消",
  );
  expect(f.created).not.toHaveBeenCalled();
  expect(await f.provider.generateText("优化正文", undefined, new AbortController().signal)).toBe(
    "ACP 回答",
  );
  expect(f.tasks.size).toBe(0);
});

it("会话设置仅提交已公布选项，返回完整依赖配置，不在本地猜测模型参数", async () => {
  const f = await fixture("codex");
  const option: acp.SessionConfigOption = {
    id: "model",
    name: "模型",
    type: "select",
    category: "model",
    currentValue: "a",
    options: [
      { value: "a", name: "A" },
      { value: "b", name: "B" },
    ],
  };
  f.created.mockReturnValueOnce({ sessionId: "native", configOptions: [option] });
  const changed: acp.SessionConfigOption[] = [
    { ...option, currentValue: "b" },
    { id: "effort", name: "推理", type: "boolean", currentValue: false },
  ];
  const set = vi.fn(() => ({ configOptions: changed }));
  f.app.onRequest(acp.methods.agent.session.setConfigOption, set);
  const task = await f.provider.startTask();
  expect(await f.provider.readSessionConfiguration(task.id)).toEqual([option]);
  await expect(f.provider.setSessionConfiguration(task.id, "model", "unknown")).rejects.toThrow(
    "选项",
  );
  expect(set).not.toHaveBeenCalled();
  expect(await f.provider.setSessionConfiguration(task.id, "model", "b")).toEqual(changed);
  expect(await f.provider.readSessionConfiguration(task.id)).toEqual(changed);
});

it("执行状态写入失败时不占用运行回合，允许安全重试", async () => {
  const f = await fixture("codex");
  const original = f.catalog.getMockImplementation();
  if (!original) throw new Error("缺少夹具");
  let failed = false;
  f.catalog.mockImplementation((operation, value) => {
    if (operation === "task.patch" && value.status === "active" && !failed) {
      failed = true;
      throw new Error("状态写入失败");
    }
    return original(operation, value);
  });
  const task = await f.provider.startTask();
  await expect(f.provider.startTurn(task.id, input, {} as AgentTurnOptions)).rejects.toThrow(
    "状态写入失败",
  );
  await expect(f.provider.startTurn(task.id, input, {} as AgentTurnOptions)).resolves.toMatchObject(
    { status: "running" },
  );
  expect(f.created).toHaveBeenCalledOnce();
});

it("ACP 提交前失败明确标注未发送，历史落盘完成后才续发下一条", async () => {
  const submitted = vi.fn(() => Promise.resolve({ stopReason: "end_turn" as const }));
  const f = await fixture("codex", submitted);
  const task = await f.provider.startTask();
  const original = f.catalog.getMockImplementation();
  if (!original) throw new Error("缺少夹具");
  f.catalog.mockImplementationOnce(() => {
    throw new Error("目录不可用");
  });
  await expect(f.provider.startConfiguredTurn(task.id, input)).rejects.toMatchObject({
    name: "AgentTurnNotSubmittedError",
  });
  expect(submitted).not.toHaveBeenCalled();
  const entered = Promise.withResolvers<undefined>(),
    gate = Promise.withResolvers<undefined>();
  const append = f.history.append.bind(f.history);
  vi.spyOn(f.history, "append").mockImplementationOnce(async (...args) => {
    entered.resolve(undefined);
    await gate.promise;
    await append(...args);
  });
  await f.provider.startConfiguredTurn(task.id, input);
  await entered.promise;
  const next = f.provider.startConfiguredTurn(task.id, { ...input, text: "下一条" });
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(submitted).toHaveBeenCalledTimes(1);
  } finally {
    gate.resolve(undefined);
  }
  await next;
  await expect.poll(() => submitted.mock.calls.length).toBe(2);
});

it("附件随用户消息持久化，原始输入删除后仍可按任务读取", async () => {
  const f = await fixture("claude");
  const task = await f.provider.startTask();
  await f.provider.startTurn(
    task.id,
    { ...input, textAttachments: [{ name: "proof.txt", text: "proof" }] },
    {} as AgentTurnOptions,
  );
  await expect
    .poll(async () => (await f.provider.readTask(task.id)).turns.at(-1)?.status)
    .toBe("completed");
  const snapshot = await f.provider.readTask(task.id);
  const user = snapshot.turns[0]?.items.find(
    (item) => item.type === "message" && item.role === "user",
  );
  if (user?.type !== "message" || !user.attachments?.[0]) throw new Error("用户附件缺失");
  const attachment = await f.provider.readTaskAttachment(task.id, user.attachments[0].id);
  expect(Buffer.from(attachment?.content ?? []).toString()).toBe("proof");
  const other = await f.provider.startTask();
  expect(await f.provider.readTaskAttachment(other.id, user.attachments[0].id)).toBeUndefined();
});
