import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect, vi } from "vitest";
import { AcpHistory } from "./history.js";
import { addAcpGlobalInstructions } from "./global-instructions.js";
import { AcpReplay } from "./replay.js";
import type { AgentTurn } from "@codexly/protocol";
it("完整重放分批保存并稳定消息身份，失败不替换旧历史", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-replay-"));
  try {
    const history = new AcpHistory(directory);
    const replay = new AcpReplay(history, "task");
    for (let i = 0; i < 45; i++) {
      await replay.update({
        sessionUpdate: "user_message_chunk",
        messageId: `user-${String(i)}`,
        content: { type: "text", text: "问题" },
      });
      await replay.update({
        sessionUpdate: "agent_message_chunk",
        messageId: `reply-${String(i)}`,
        content: { type: "text", text: "回答" },
      });
    }
    await replay.complete();
    let page = await history.read("task");
    expect(page.turns).toHaveLength(20);
    const ids = page.turns.map((t) => t.id);
    while (page.cursor) {
      page = await history.read("task", page.cursor);
      ids.unshift(...page.turns.map((t) => t.id));
    }
    expect(new Set(ids).size).toBe(45);
    const failed = new AcpReplay(history, "task");
    await failed.update({
      sessionUpdate: "user_message_chunk",
      messageId: "test-message",
      content: { type: "text", text: "失败内容" },
    });
    await failed.abort(new Error("断线"));
    expect((await history.read("task")).turns).toHaveLength(20);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("历史写锁被拒绝时重放立即失败，不能让无消费者的数据流永久等待", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-replay-busy-"));
  const history = new AcpHistory(directory);
  const entered = Promise.withResolvers<undefined>(),
    release = Promise.withResolvers<undefined>();
  const writing = history.replace(
    "task",
    (async function* () {
      entered.resolve(undefined);
      await release.promise;
      yield* [];
    })(),
  );
  try {
    await entered.promise;
    const replay = new AcpReplay(history, "task");
    await replay.update({
      sessionUpdate: "user_message_chunk",
      messageId: "test-message",
      content: { type: "text", text: "问题" },
    });
    let failure: unknown;
    const completed = replay.complete().catch((error: unknown) => {
      failure = error;
    });
    await vi.waitFor(() => {
      expect(failure).toBeInstanceOf(Error);
    });
    await completed;
    expect((failure as Error).message).toContain("写入");
  } finally {
    release.resolve(undefined);
    await writing;
    await rm(directory, { recursive: true, force: true });
  }
});

it("重放确认原输入后保留应用回合、消息身份和历史附件，错序内容不借用旧身份", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-replay-anchor-"));
  const history = new AcpHistory(directory);
  const attachment = {
    id: "attachment",
    kind: "file" as const,
    name: "资料.txt",
    mediaType: "text/plain",
    size: 3,
  };
  const original: AgentTurn = {
    id: "original-turn",
    status: "completed",
    startedAt: "2026-11-12T00:00:00Z",
    completedAt: "2026-11-12T00:00:01Z",
    error: null,
    items: [
      {
        id: "original-user",
        type: "message",
        role: "user",
        text: "原始正文",
        attachments: [attachment],
      },
      { id: "original-answer", type: "message", role: "assistant", text: "原始回答" },
    ],
  };
  try {
    await history.append("task", original, "原始正文[资料.txt](file:///saved)");
    const replay = new AcpReplay(history, "task");
    const instructions = addAcpGlobalInstructions([], "使用中文📝".repeat(2_500))[0];
    if (instructions?.type !== "text" || typeof instructions.text !== "string")
      throw new Error("缺少指令文本块");
    for (const text of [instructions.text.slice(0, 9), instructions.text.slice(9)]) {
      await replay.update({
        sessionUpdate: "user_message_chunk",
        messageId: "native-user",
        content: { type: "text", text },
      });
    }
    await replay.update({
      sessionUpdate: "user_message_chunk",
      messageId: "native-user",
      content: { type: "text", text: "原始正文" },
    });
    await replay.update({
      sessionUpdate: "user_message_chunk",
      messageId: "native-user",
      content: { type: "resource_link", name: "资料.txt", uri: "file:///saved" },
    });
    await replay.update({
      sessionUpdate: "agent_message_chunk",
      messageId: "native-reply",
      content: { type: "text", text: "原始回答" },
    });
    await replay.complete();
    const [restored] = (await history.read("task")).turns;
    expect(restored).toEqual(original);
    const following = {
      ...original,
      id: "following",
      items: original.items.map((item) =>
        item.type === "message" && item.role === "user" ? { ...item, text: "另一个问题" } : item,
      ),
    };
    await history.append("task", following, "另一个问题");
    const changed = new AcpReplay(history, "task");
    await changed.update({
      sessionUpdate: "user_message_chunk",
      messageId: "different",
      content: { type: "text", text: "不同问题" },
    });
    await changed.update({
      sessionUpdate: "agent_message_chunk",
      messageId: "test-message",
      content: { type: "text", text: "原始回答" },
    });
    await changed.update({
      sessionUpdate: "user_message_chunk",
      messageId: "following-user",
      content: { type: "text", text: "另一个问题" },
    });
    await changed.update({
      sessionUpdate: "agent_message_chunk",
      messageId: "following-reply",
      content: { type: "text", text: "原始回答" },
    });
    await changed.complete();
    const [replaced, preserved] = (await history.read("task")).turns;
    expect(replaced?.id).not.toBe(original.id);
    expect(preserved).toEqual(following);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("回执消息 ID 将断线后回放的正文合并到原回合，并保留已知状态", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-replay-receipt-"));
  try {
    const history = new AcpHistory(directory);
    const old: AgentTurn = {
      id: "local-turn",
      status: "failed",
      error: "任务结果待确认",
      startedAt: "2026-11-21T08:00:00.000Z",
      completedAt: null,
      items: [{ id: "local-input", type: "message", role: "user", text: "原始问题" }],
    };
    await history.append("task", old, "原始问题", undefined, true, "agent-message");
    const replay = new AcpReplay(history, "task");
    await replay.update({
      sessionUpdate: "user_message_chunk",
      messageId: "agent-message",
      content: { type: "text", text: "原始问题" },
    });
    await replay.update({
      sessionUpdate: "agent_message_chunk",
      messageId: "reply",
      content: { type: "text", text: "断线后保存的回答" },
    });
    await replay.complete();
    const page = await history.read("task");
    expect(page.turns).toHaveLength(1);
    expect(page.turns[0]).toMatchObject({
      id: old.id,
      status: old.status,
      startedAt: old.startedAt,
      items: [old.items[0], { role: "assistant", text: "断线后保存的回答" }],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it.each([
  { type: "resource_link", name: "方案.txt", uri: "file:///saved" },
  { type: "text", text: "[@方案.txt](file:///saved)" },
] as const)("重放将不同消息 ID 的引导和回答留在原回合并恢复原附件（$type）", async (attachment) => {
  const directory = await mkdtemp(join(tmpdir(), "acp-replay-steering-"));
  try {
    const history = new AcpHistory(directory);
    const old: AgentTurn = {
      id: "local-turn",
      status: "failed",
      error: "任务结果待确认",
      startedAt: "2026-11-21T08:00:00.000Z",
      completedAt: null,
      items: [
        { id: "local-input", type: "message", role: "user", text: "原始问题" },
        {
          id: "local-steer",
          type: "message",
          role: "user",
          text: "改用这个方案",
          attachments: [
            { id: "file-ref", kind: "file", name: "方案.txt", mediaType: "text/plain", size: 4 },
          ],
        },
      ],
    };
    await history.append("task", old, "原始问题", undefined, true, "agent-original");
    const next: AgentTurn = {
      ...old,
      id: "local-next",
      items: [{ id: "local-next-input", type: "message", role: "user", text: "改用这个方案" }],
    };
    await history.append("task", next, "改用这个方案", undefined, false, "agent-next");
    const replay = new AcpReplay(history, "task");
    await replay.update({
      sessionUpdate: "user_message_chunk",
      messageId: "agent-original",
      content: { type: "text", text: "原始问题" },
    });
    for (const content of [
      { type: "text", text: "改用" } as const,
      { type: "text", text: "这个方案" } as const,
      attachment,
    ]) {
      await replay.update({
        sessionUpdate: "user_message_chunk",
        messageId: "agent-steer",
        content,
      });
    }
    await replay.update({
      sessionUpdate: "agent_message_chunk",
      messageId: "agent-reply",
      content: { type: "text", text: "按引导生成的回答" },
    });
    await replay.update({
      sessionUpdate: "user_message_chunk",
      messageId: "agent-next",
      content: { type: "text", text: "改用这个方案" },
    });
    await replay.complete();
    expect((await history.read("task")).turns).toMatchObject([
      {
        id: old.id,
        status: old.status,
        items: [...old.items, { role: "assistant", text: "按引导生成的回答" }],
      },
      { id: next.id, items: next.items },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("v1 缺少消息 ID 时按角色段回放，不将局部身份记录为 Agent 回执", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-v1-no-id-"));
  const history = new AcpHistory(directory);
  try {
    const replay = new AcpReplay(history, "task");
    for (const text of ["问题一", "问题二"]) {
      await replay.update({ sessionUpdate: "user_message_chunk", content: { type: "text", text } });
      await replay.update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "答" },
      });
      await replay.update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "案" },
      });
    }
    await replay.complete();
    const original = (await history.read("task")).turns;
    expect(original).toHaveLength(2);
    expect(original[0]?.items).toMatchObject([{ text: "问题一" }, { text: "答案" }]);
    for await (const entry of history.entries("task")) expect(entry.acpMessageId).toBeUndefined();
    const again = new AcpReplay(history, "task");
    for (const [i, text] of ["问题一", "问题二"].entries()) {
      await again.update({
        sessionUpdate: "user_message_chunk",
        messageId: `native-${String(i)}`,
        content: { type: "text", text },
      });
      await again.update({
        sessionUpdate: "agent_message_chunk",
        messageId: `reply-${String(i)}`,
        content: { type: "text", text: "答案" },
      });
    }
    await again.complete();
    expect((await history.read("task")).turns.map((turn) => turn.id)).toEqual(
      original.map((turn) => turn.id),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
