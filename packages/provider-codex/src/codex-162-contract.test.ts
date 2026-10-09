import { describe, expect, it } from "vitest";
import { mapAgentItem } from "./codex-item-mapping.js";
import {
  FakeRpcClient,
  createCodexAgentProvider,
  nativeThread,
  project,
} from "./agent-provider.test-support.js";

describe("Codex 0.162 protocol contract", () => {
  it("preserves partial answers in history and live items without declaring turn completion", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: unknown[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();
    const item = {
      id: "partial-1",
      type: "agentMessage",
      text: "已完成第一部分，继续验证。",
      phase: "partial_answer",
      questions: null,
      delivery: null,
    };
    const history = mapAgentItem(item);
    expect(history).toMatchObject({ type: "message", phase: "partial_answer", text: item.text });
    for (const method of ["item/started", "item/completed"]) {
      rpc.emitNotification(method, { threadId: "task-1", turnId: "turn-1", item });
    }
    expect(events).toContainEqual(
      expect.objectContaining({ type: "item.completed", payload: { item: history } }),
    );
    expect(events).not.toContainEqual(expect.objectContaining({ type: "turn.completed" }));
  });
});
