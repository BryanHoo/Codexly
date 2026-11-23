import { expect, it, vi } from "vitest";
import * as acp from "@agentclientprotocol/sdk/unstable";
import { fixture, input } from "./provider.test-support.js";
import { routeAcpUpdate } from "./provider-session-events.js";
import { AcpSubagentSessions } from "./subagent-sessions.js";

it("子会话同名工具分别归属，原始审批选项回复到发起请求的子会话", async () => {
  const finished = Promise.withResolvers<unknown[]>();
  const f = await fixture("codex", async ({ params, client }) => {
    const update = (sessionId: string, update: acp.SessionUpdate) =>
      client.notify(acp.methods.client.session.update, { sessionId, update });
    for (const sessionId of ["first", "second"]) {
      await update(params.sessionId, {
        sessionUpdate: "subagent_update",
        sessionId,
        title: sessionId,
      });
      await update(sessionId, {
        sessionUpdate: "tool_call",
        toolCallId: "shared",
        title: sessionId,
        rawInput: { label: sessionId },
      });
    }
    const permission = (sessionId: string) =>
      client.request(acp.methods.client.session.requestPermission, {
        sessionId,
        toolCall: { toolCallId: "shared" },
        options: [{ optionId: sessionId, name: "允许", kind: "allow_once" }],
      });
    finished.resolve(await Promise.all(["first", "second", "unannounced"].map(permission)));
    return { stopReason: "end_turn" };
  });
  const task = await f.provider.startTask();
  await f.provider.startConfiguredTurn(task.id, input);
  await expect
    .poll(async () => (await f.provider.readTask(task.id)).pendingRequests.length)
    .toBe(2);
  const snapshot = await f.provider.readTask(task.id);
  const requests = snapshot.pendingRequests;
  expect(requests.map((request) => request.acpSubagent?.sessionId)).toEqual(["first", "second"]);
  expect(requests).toMatchObject([
    { toolName: "first", input: { label: "first" } },
    { toolName: "second", input: { label: "second" } },
  ]);
  expect(new Set(requests.map((request) => request.itemId)).size).toBe(2);
  for (const request of [...requests].reverse()) {
    expect(snapshot.turns.at(-1)?.items.some((item) => item.id === request.itemId)).toBe(true);
    if (!request.acpSubagent) throw new Error("缺少子会话审批归属");
    await f.provider.resolvePendingRequest({
      requestId: request.requestId,
      projectId: request.projectId,
      taskId: task.id,
      turnId: request.turnId,
      itemId: request.itemId,
      type: "tool_approval",
      resolution: { decision: "allow", optionId: request.acpSubagent.sessionId },
    });
  }
  expect(await finished.promise).toEqual([
    { outcome: { outcome: "selected", optionId: "first" } },
    { outcome: { outcome: "selected", optionId: "second" } },
    { outcome: { outcome: "cancelled" } },
  ]);
});

it("父回合完成后，子会话继续接收审批和流式输出", async () => {
  const release = Promise.withResolvers<undefined>();
  const late = Promise.withResolvers<unknown>();
  let background: Promise<void> | undefined;
  const f = await fixture("codex", async ({ params, client }) => {
    const update = (sessionId: string, update: acp.SessionUpdate) =>
      client.notify(acp.methods.client.session.update, { sessionId, update });
    const sessionId = "background";
    await update(params.sessionId, {
      sessionUpdate: "subagent_update",
      sessionId,
      state: { state: "running" },
    });
    background = release.promise.then(async () => {
      late.resolve(
        await client.request(acp.methods.client.session.requestPermission, {
          sessionId,
          toolCall: { toolCallId: "late", title: "后台调用" },
          options: [{ optionId: "once", name: "允许", kind: "allow_once" }],
        }),
      );
      await update(sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "后台子会话输出" },
      });
      await update(params.sessionId, {
        sessionUpdate: "subagent_update",
        sessionId,
        state: { state: "idle", stopReason: "end_turn" },
      });
    });
    return { stopReason: "end_turn" };
  });
  const task = await f.provider.startTask();
  await f.provider.startConfiguredTurn(task.id, input);
  await expect.poll(async () => (await f.provider.readTask(task.id)).status).toBe("idle");
  release.resolve(undefined);
  await expect
    .poll(async () => (await f.provider.readTask(task.id)).pendingRequests.length)
    .toBe(1);
  const snapshot = await f.provider.readTask(task.id);
  expect(snapshot.status).toBe("idle");
  const request = snapshot.pendingRequests[0];
  if (!request) throw new Error("缺少后台审批");
  expect(request.acpSubagent?.sessionId).toBe("background");
  await f.provider.resolvePendingRequest({
    requestId: request.requestId,
    projectId: request.projectId,
    taskId: task.id,
    turnId: request.turnId,
    itemId: request.itemId,
    type: "tool_approval",
    resolution: { decision: "allow", optionId: "once" },
  });
  expect(await late.promise).toEqual({ outcome: { outcome: "selected", optionId: "once" } });
  await background;
  await expect
    .poll(async () => (await f.provider.readTask(task.id)).turns.at(-1)?.items)
    .toContainEqual(expect.objectContaining({ type: "message", text: "后台子会话输出" }));
});

it("只加载根会话并重放嵌套子会话，流式委派可被完整消息替换", async () => {
  const f = await fixture("claude");
  const task = await f.provider.startTask();
  await f.provider.readSessionState(task.id);
  await f.provider.unsubscribeTask(task.id);
  f.loaded.mockImplementationOnce(async ({ params, client }) => {
    const update = (sessionId: string, update: acp.SessionUpdate) =>
      client.notify(acp.methods.client.session.update, { sessionId, update });
    await update(params.sessionId, {
      sessionUpdate: "user_message_chunk",
      messageId: "question",
      content: { type: "text", text: "根问题" },
    });
    await update(params.sessionId, { sessionUpdate: "subagent_update", sessionId: "child" });
    await update("child", { sessionUpdate: "subagent_update", sessionId: "nested" });
    await update("nested", {
      sessionUpdate: "session_message_chunk",
      messageId: "delegation",
      content: { type: "text", text: "部分" },
    });
    await update("nested", {
      sessionUpdate: "session_message",
      messageId: "delegation",
      recipientSessionId: "nested",
      content: [{ type: "text", text: "完整委派" }],
    });
    await update("nested", {
      sessionUpdate: "agent_message_chunk",
      messageId: "answer",
      content: { type: "text", text: "嵌套回复" },
    });
    await update(params.sessionId, {
      sessionUpdate: "agent_message_chunk",
      messageId: "answer",
      content: { type: "text", text: "根回复" },
    });
    return {};
  });
  const snapshot = await f.provider.readTask(task.id);
  expect(f.loaded).toHaveBeenCalledOnce();
  expect(snapshot.turns).toHaveLength(1);
  expect(snapshot.turns[0]?.items).toEqual([
    expect.objectContaining({ role: "user", text: "根问题" }),
    expect.objectContaining({
      type: "acp_subagent",
      sessionId: "child",
      parentSessionId: "native",
    }),
    expect.objectContaining({
      type: "acp_subagent",
      sessionId: "nested",
      parentSessionId: "child",
    }),
    expect.objectContaining({ text: "完整委派" }),
    expect.objectContaining({ text: "嵌套回复" }),
    expect.objectContaining({ text: "根回复" }),
  ]);
});

it.each([true, false])("历史子会话保留记录并释放连接容量（支持 close：%s）", async (close) => {
  const f = await fixture("claude", undefined, undefined, {
    capabilities: { loadSession: true, sessionCapabilities: close ? { close: {} } : {} },
  });
  const task = await f.provider.startTask();
  const stored = f.tasks.get(task.id);
  if (!stored) throw new Error("缺少测试任务");
  stored.sessionId = "saved";
  f.loaded.mockImplementation(async ({ params, client }) => {
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: "subagent_update", sessionId: "child", state: { state: "running" } },
    });
    await client.notify(acp.methods.client.session.update, {
      sessionId: "child",
      update: {
        sessionUpdate: "subagent_update",
        sessionId: "nested",
        state: { state: "requires_action" },
      },
    });
    return {};
  });

  const snapshot = await f.provider.readTask(task.id);
  expect(snapshot.turns[0]?.items).toEqual([
    expect.objectContaining({ type: "acp_subagent", sessionId: "child", state: "running" }),
    expect.objectContaining({
      type: "acp_subagent",
      sessionId: "nested",
      state: "requires_action",
    }),
  ]);

  // 等历史落盘后再推进时钟，分别验证原生关闭和暖连接的空闲回收。
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    expect(await f.provider.unsubscribeTask(task.id)).toBe("unsubscribed");
    expect(f.closed).toHaveBeenCalledTimes(close ? 1 : 0);
    await vi.advanceTimersByTimeAsync(30_000);
    await f.provider.readSessionState(task.id);
    expect(f.connected).toHaveBeenCalledTimes(close ? 1 : 2);
    expect(f.loaded).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it("实时子会话状态保护连接，省略状态的补丁延续已有确认", async () => {
  const subagents = new AcpSubagentSessions();
  const sessions = new Map([["task", "root"]]);
  const announce = (historical: boolean, patch: Partial<acp.SubagentUpdate>) =>
    routeAcpUpdate(
      {
        sessionId: "root",
        update: { sessionUpdate: "subagent_update", sessionId: "child", ...patch },
      },
      historical,
      sessions,
      new Map(),
      new Map(),
      () => undefined,
      subagents,
    );
  await announce(true, { state: { state: "running" } });
  await announce(false, { title: "实时标题" });
  expect(subagents.hasWork()).toBe(false);

  for (const state of ["running", "requires_action"] as const) {
    await announce(false, { state: { state } });
    await announce(false, { title: "更新标题" });
    expect(subagents.hasWork("root")).toBe(true);
  }
  await announce(false, { state: { state: "idle" } });
  expect(subagents.hasWork("root")).toBe(false);

  await announce(false, { state: { state: "running" } });
  subagents.resetWork("root");
  expect(subagents.hasWork("root")).toBe(false);
  expect(subagents.get("child")?.rootSessionId).toBe("root");
});
