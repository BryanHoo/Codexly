import { projectAcpConfig } from "./session-options.js";
import { testPrompt } from "./acp-v1-peer.test-support.js";
import { rm, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { it, expect, vi } from "vitest";
import * as acp from "@agentclientprotocol/sdk/unstable";
import type { AgentProviderEvent } from "@codexly/core";
import type { AgentTurnOptions, AcpConfigOption } from "@codexly/protocol";
import type { AcpConnection } from "./connection.js";
import { fixture, input } from "./provider.test-support.js";
it.each(["codex", "claude"] as const)(
  "%s 用量事件与活动、完成及后续回合快照一致",
  async (engine) => {
    const gate = Promise.withResolvers<{ stopReason: "end_turn" | "cancelled" }>();
    const f = await fixture(engine, async ({ params, client }) => {
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: "usage_update", used: 53000, size: 200000 },
      });
      return gate.promise;
    });
    const events: AgentProviderEvent[] = [];
    f.provider.subscribeEvents((event) => {
      events.push(event);
    });
    const task = await f.provider.startTask();
    expect((await f.provider.readTask(task.id)).contextUsage).toBeNull();
    const turn = await f.provider.startTurn(task.id, input, {} as AgentTurnOptions);
    try {
      await vi.waitFor(() => {
        expect(events.find((event) => event.type === "usage.updated")).toMatchObject({
          taskId: task.id,
          turnId: turn.id,
          provider: engine,
          payload: { usage: { usedTokens: 53000, contextWindow: 200000 } },
        });
      });
      const snapshot = await f.provider.readTask(task.id);
      expect(snapshot.contextUsage).toEqual({ usedTokens: 53000, contextWindow: 200000 });
      expect(snapshot.status).toBe("running");
      gate.resolve({ stopReason: "end_turn" });
      await expect.poll(async () => (await f.provider.readTask(task.id)).status).toBe("idle");
      expect((await f.provider.readTask(task.id)).contextUsage).toEqual(snapshot.contextUsage);
      f.app.onRequest(
        acp.methods.agent.session.prompt,
        testPrompt(() => ({ stopReason: "end_turn" })),
      );
      await f.provider.startTurn(task.id, input, {} as AgentTurnOptions);
      expect((await f.provider.readTask(task.id)).contextUsage).toEqual(snapshot.contextUsage);
      await expect.poll(async () => (await f.provider.readTask(task.id)).status).toBe("idle");
      await f.provider.unsubscribeTask(task.id);
      expect((await f.provider.readTask(task.id)).contextUsage).toBeNull();
    } finally {
      gate.resolve({ stopReason: "end_turn" });
    }
  },
);

it("会话创建响应前与历史重放中的用量进入快照，不伪造历史回合", async () => {
  const f = await fixture("codex");
  f.created.mockImplementationOnce(async ({ client }) => {
    await client.notify(acp.methods.client.session.update, {
      sessionId: "native",
      update: { sessionUpdate: "usage_update", used: 53000, size: 200000 },
    });
    return { sessionId: "native" };
  });
  const task = await f.provider.startTask();
  await f.provider.readSessionState(task.id);
  expect((await f.provider.readTask(task.id)).contextUsage).toEqual({
    usedTokens: 53000,
    contextWindow: 200000,
  });
  await f.provider.unsubscribeTask(task.id);
  f.loaded.mockImplementationOnce(async ({ params, client }) => {
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: "usage_update", used: 12000, size: 200000 },
    });
    return {};
  });
  const snapshot = await f.provider.readTask(task.id);
  expect(snapshot.contextUsage).toEqual({ usedTokens: 12000, contextWindow: 200000 });
  expect(snapshot.turns).toEqual([]);
});

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
        availableCommands: [
          {
            type: "command",
            name: "review",
            description: "检查",
            input: { type: "text", hint: "范围" },
          },
        ],
      },
    });
    return {
      sessionId: "native",
      configOptions: config,
      availableCommands: [
        {
          type: "command",
          name: "review",
          description: "检查",
          input: { type: "text", hint: "范围" },
        },
      ],
    };
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
    configOptions: projectAcpConfig(config),
    availableCommands: [{ name: "review", description: "检查", input: { hint: "范围" } }],
  });
  await f.provider.setSessionConfiguration(task.id, "mode", true);
  expect(events.findLast((event) => event.type === "acp.session.updated")).toMatchObject({
    taskId: task.id,
    payload: {
      state: {
        configOptions: projectAcpConfig(updated),
        availableCommands: state.availableCommands,
      },
    },
  });
  expect((await f.provider.readTask(task.id)).acpSession).toEqual({
    configOptions: projectAcpConfig(updated),
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
  expect(snapshot.runtime).toBe("acp");
  expect(snapshot).not.toHaveProperty("settings");
  expect(f.created).not.toHaveBeenCalled();
});
it("新会话应用默认值失败后重试原绑定，已有历史会话不套用全局默认值", async () => {
  const initialize = vi.fn((_connection: AcpConnection, _id: string, options: AcpConfigOption[]) =>
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
  const file = content.find((block) => block.type === "resource_link");
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
  expect(await f.provider.readSessionConfiguration(task.id)).toEqual(projectAcpConfig([option]));
  await expect(f.provider.setSessionConfiguration(task.id, "model", "unknown")).rejects.toThrow(
    "选项",
  );
  expect(set).not.toHaveBeenCalled();
  expect(await f.provider.setSessionConfiguration(task.id, "model", "b")).toEqual(
    projectAcpConfig(changed),
  );
  expect(await f.provider.readSessionConfiguration(task.id)).toEqual(projectAcpConfig(changed));
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

it("首发原始配置先于 prompt 生效，覆盖失效全局默认值且不要求旧模型", async () => {
  const order: string[] = [];
  const initialize = vi.fn(() => Promise.reject(new Error("失效全局默认值")));
  const f = await fixture(
    "claude",
    () => {
      order.push("prompt");
      return Promise.resolve({ stopReason: "end_turn" });
    },
    initialize,
  );
  f.created.mockReturnValue({
    sessionId: "native",
    configOptions: [{ id: "enabled", name: "开关", type: "boolean", currentValue: true }],
  });
  f.app.onRequest(acp.methods.agent.session.setConfigOption, ({ params }) => {
    order.push("config");
    expect(params.value).toBe(false);
    return {
      configOptions: [{ id: "enabled", name: "开关", type: "boolean", currentValue: false }],
    };
  });
  const task = await f.provider.startTask();
  await f.provider.startConfiguredTurn(task.id, input, { enabled: false });
  await vi.waitFor(() => {
    expect(order).toEqual(["config", "prompt"]);
  });
  expect(initialize).not.toHaveBeenCalled();
});

it("ACP 原生问卷在会话快照中展示并校验回答", async () => {
  const outcome = Promise.withResolvers<acp.CreateElicitationResponse>();
  const f = await fixture("codex", async ({ params, client }) => {
    outcome.resolve(
      await client.request(acp.methods.client.elicitation.create, {
        sessionId: params.sessionId,
        toolCallId: "question",
        mode: "form",
        message: "命名",
        requestedSchema: {
          type: "object",
          properties: { name: { type: "string", pattern: "^[A-Z]+$" } },
          required: ["name"],
        },
      }),
    );
    return { stopReason: "end_turn" };
  });
  const task = await f.provider.startTask();
  await f.provider.startTurn(task.id, input, {} as AgentTurnOptions);
  const request = await vi.waitFor(async () => {
    const pending = (await f.provider.readTask(task.id)).pendingRequests[0];
    expect(pending).toMatchObject({
      type: "mcp_elicitation",
      acp: true,
      itemId: "acp:tool:question",
    });
    if (!pending) throw new Error("问卷尚未到达");
    return pending;
  });
  await expect(
    f.provider.resolvePendingRequest({
      ...request,
      type: "mcp_elicitation",
      resolution: { action: "accept", content: { name: "wrong" } },
    }),
  ).rejects.toThrow();
  await f.provider.resolvePendingRequest({
    ...request,
    type: "mcp_elicitation",
    resolution: { action: "accept", content: { name: "OK" } },
  });
  await expect(outcome.promise).resolves.toEqual({ action: "accept", content: { name: "OK" } });
});

it("ACP URL 同意只回传 action，只有匹配的通知才确认外部完成", async () => {
  const answered = Promise.withResolvers<acp.CreateElicitationResponse>();
  const continueTurn = Promise.withResolvers<undefined>();
  const peer = Promise.withResolvers<acp.AgentRequestContext<acp.PromptRequest>["client"]>();
  const f = await fixture("claude", async ({ params, client }) => {
    peer.resolve(client);
    const create = (url: string, sessionId = params.sessionId) =>
      client.request(acp.methods.client.elicitation.create, {
        mode: "url",
        message: "连接账户",
        sessionId,
        url,
        elicitationId: "opaque",
      });
    await expect(create("https://user:password@example.test")).rejects.toMatchObject({
      code: -32602,
    });
    await expect(create("https://example.test", "unknown")).resolves.toEqual({ action: "cancel" });
    answered.resolve(await create("https://example.test/connect"));
    await continueTurn.promise;
    return { stopReason: "end_turn" };
  });
  const events: AgentProviderEvent[] = [];
  f.provider.subscribeEvents((event) => events.push(event));
  const task = await f.provider.startTask();
  await f.provider.startConfiguredTurn(task.id, input);
  try {
    const client = await peer.promise;
    const request = await vi.waitFor(async () => {
      const request = (await f.provider.readTask(task.id)).pendingRequests[0];
      if (request?.type !== "mcp_elicitation" || request.mode !== "url")
        throw new Error("URL 请求尚未到达");
      return request;
    });
    const payload = { ...request, resolution: { action: "accept", content: {} } } as const;
    await expect(
      f.provider.resolvePendingRequest({ ...payload, turnId: "unrelated" }),
    ).rejects.toThrow();
    await expect(f.provider.resolvePendingRequest(payload)).resolves.toMatchObject({
      externalStatus: "opened",
      status: "resolved",
    });
    await expect(answered.promise).resolves.toEqual({ action: "accept" });
    continueTurn.resolve(undefined);
    await vi.waitFor(async () => {
      expect((await f.provider.readTask(task.id)).status).toBe("idle");
    });
    const completion = acp.methods.client.elicitation.complete;
    await client.notify(completion, { elicitationId: "unknown" });
    await client.notify(completion, { elicitationId: "opaque" });
    await client.notify(completion, { elicitationId: "opaque" });
    const resolutionEvents = () =>
      events.filter((event) => event.type === "pending_request.resolved");
    await vi.waitFor(() => {
      expect(resolutionEvents()).toHaveLength(2);
    });
    expect(resolutionEvents().map(({ payload }) => payload.request)).toMatchObject([
      { externalStatus: "opened" },
      { externalStatus: "completed" },
    ]);
  } finally {
    continueTurn.resolve(undefined);
  }
});
