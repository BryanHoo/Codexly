import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { AcpHistory } from "./history.js";
import { AcpReplay } from "./replay.js";
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
