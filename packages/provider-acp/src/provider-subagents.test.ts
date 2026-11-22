import { expect, it } from "vitest";
import * as acp from "@agentclientprotocol/sdk/unstable";
import { fixture, input } from "./provider.test-support.js";

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
