import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect, vi } from "vitest";
import { AcpHistory } from "./history.js";
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
    const changed = new AcpReplay(history, "task");
    await changed.update({
      sessionUpdate: "user_message_chunk",
      messageId: "different",
      content: { type: "text", text: "不同问题" },
    });
    await changed.update({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "原始回答" },
    });
    await changed.complete();
    expect((await history.read("task")).turns[0]?.id).not.toBe(original.id);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
