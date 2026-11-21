import * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable";
import type { AgentProviderEvent } from "@codexly/core";
import type { AgentTurn } from "@codexly/protocol";
import { expect, it, vi } from "vitest";
import { AcpHistory } from "./history.js";
import { AcpReplay } from "./replay.js";
import { fixture, input } from "./provider.test-support.js";

it.each(["end_turn", "refusal", "max_tokens", "max_turn_requests", "cancelled"] as const)(
  "停止原因 %s 在完成事件和重新读取历史后保持一致",
  async (stopReason) => {
    const f = await fixture("codex", () => Promise.resolve({ stopReason }));
    const completed = Promise.withResolvers<AgentTurn>();
    f.provider.subscribeEvents((event) => {
      if (event.type !== "turn.completed") return;
      completed.resolve(event.payload.turn);
    });
    const task = await f.provider.startTask();
    await f.provider.startConfiguredTurn(task.id, input);
    expect((await completed.promise).stopReason).toBe(stopReason);
    const reopened = new AcpHistory(f.history.directory);
    expect((await reopened.read(task.id)).turns[0]?.stopReason).toBe(stopReason);
  },
);

it("超长回答和工具输出保存为受控附件，刷新后仍可读且可以继续发送", async () => {
  const answer = "回答😀".repeat(240_000);
  const output = "输出".repeat(410_000);
  const handler = vi.fn(async ({ params, client }: acp.AgentRequestContext<acp.PromptRequest>) => {
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "log",
        title: "运行",
        status: "completed",
        rawOutput: output,
      },
    });
    for (let offset = 0; offset < answer.length; offset += 32_000) {
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "test-message",
          content: { type: "text", text: answer.slice(offset, offset + 32_000) },
        },
      });
    }
    return { stopReason: "end_turn" as const };
  });
  const f = await fixture("codex", handler);
  const events: AgentProviderEvent[] = [];
  f.provider.subscribeEvents((event) => {
    events.push(event);
  });
  const task = await f.provider.startTask();
  await f.provider.startConfiguredTurn(task.id, input);
  const reopened = new AcpHistory(f.history.directory);
  await expect.poll(() => reopened.hasTurns(task.id), { timeout: 4_000 }).toBe(true);
  const saved = (await reopened.read(task.id)).turns[0];
  const reply = saved?.items.find((item) => item.type === "message" && item.role === "assistant");
  const tool = saved?.items.find((item) => item.type === "tool");
  expect(reply?.type).toBe("message");
  expect(tool?.type).toBe("tool");
  if (reply?.type !== "message" || tool?.type !== "tool") throw new Error("缺少历史条目");
  const read = async (id: string) => {
    const attachment = await f.provider.readTaskAttachment(task.id, id);
    if (!attachment) throw new Error("附件不可读");
    return Buffer.from(attachment.content).toString("utf8");
  };
  const restored = await Promise.all((reply.attachments ?? []).map((file) => read(file.id)));
  expect(reply.text + restored.join("")).toBe(answer);
  const logs = await Promise.all((tool.outputAttachments ?? []).map((file) => read(file.id)));
  expect(logs.join("")).toBe(output);
  expect(events.some((event) => event.type === "task.notice")).toBe(false);
  const replay = new AcpReplay(reopened, task.id);
  await replay.update({
    sessionUpdate: "user_message_chunk",
    messageId: "test-message",
    content: { type: "text", text: input.text },
  });
  await replay.update({
    sessionUpdate: "tool_call_update",
    toolCallId: "native-tool",
    title: "运行",
    status: "completed",
    rawOutput: output,
  });
  await replay.update({
    sessionUpdate: "agent_message_chunk",
    messageId: "test-message",
    content: { type: "text", text: answer },
  });
  await replay.complete();
  expect((await reopened.read(task.id)).turns).toEqual([saved]);
  await expect(f.provider.startConfiguredTurn(task.id, input)).resolves.toMatchObject({
    status: "running",
  });
});

it("磁盘空间不足时不宣告已保存，空间恢复后续发只补写同一个回合", async () => {
  const handler = vi.fn(async ({ client, params }: acp.AgentRequestContext<acp.PromptRequest>) => {
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "test-message",
        content: { type: "text", text: "回答可复制" },
      },
    });
    return { stopReason: "end_turn" as const };
  });
  const f = await fixture("codex", handler);
  const append = vi
    .spyOn(f.history, "append")
    .mockRejectedValueOnce(Object.assign(new Error("ENOSPC"), { code: "ENOSPC" }));
  const failed = Promise.withResolvers<string>();
  const completed: string[] = [];
  f.provider.subscribeEvents((event) => {
    if (event.type === "provider.error") failed.resolve(event.payload.message);
    if (event.type === "turn.completed") completed.push(event.turnId);
  });
  const task = await f.provider.startTask();
  const first = await f.provider.startConfiguredTurn(task.id, input);
  expect(await failed.promise).toContain("存储空间不足");
  expect(completed).toEqual([]);
  expect(append).toHaveBeenCalledOnce();
  const snapshot = await f.provider.readTask(task.id);
  expect(snapshot.status).toBe("failed");
  expect(snapshot.turns[0]?.id).toBe(first.id);
  expect(
    snapshot.turns[0]?.items.some((item) => item.type === "message" && item.text === "回答可复制"),
  ).toBe(true);
  const next = await f.provider.startConfiguredTurn(task.id, input);
  await expect.poll(() => completed).toEqual([first.id, next.id]);
  expect(append.mock.calls.map((call) => call[1].id)).toEqual([first.id, first.id, next.id]);
  expect(handler).toHaveBeenCalledTimes(2);
});

it("暂时性写入失败只重试同一历史回合，完成事件晚于成功落盘", async () => {
  const handler = vi.fn(() => Promise.resolve({ stopReason: "end_turn" as const }));
  const f = await fixture("codex", handler);
  const append = vi
    .spyOn(f.history, "append")
    .mockRejectedValueOnce(Object.assign(new Error("暂时占用"), { code: "EAGAIN" }));
  const completed = Promise.withResolvers<boolean>();
  const notices = vi.fn();
  f.provider.subscribeEvents((event) => {
    if (event.type === "task.notice") notices(event);
    if (event.type === "turn.completed") completed.resolve(append.mock.calls.length === 2);
  });
  const task = await f.provider.startTask();
  const turn = await f.provider.startConfiguredTurn(task.id, input);
  expect(await completed.promise).toBe(true);
  expect(append.mock.calls.map((call) => call[1].id)).toEqual([turn.id, turn.id]);
  expect((await f.history.read(task.id)).turns.map((entry) => entry.id)).toEqual([turn.id]);
  expect(handler).toHaveBeenCalledOnce();
  expect(notices).not.toHaveBeenCalled();
});
