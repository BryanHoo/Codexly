import { expect, it } from "vitest";
import type { AgentEvent } from "@codexly/protocol";
import { AcpEventProjection } from "../../../packages/provider-acp/src/event-projection.js";
import { createTaskStore } from "../../../apps/web/src/features/conversation/runtime/task-store.js";
import { createResponse } from "../../../apps/web/src/features/conversation/runtime/task-store.test-support.js";

it("ACP 公开思考通过真实 Web Store 逐段展示，完成快照保持相同文本", () => {
  const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });
  store.getState().hydrate(createResponse());
  let sequence = 10;
  const projection = new AcpEventProjection("task-1", "turn-running", (event) => {
    // 使用真实协议身份和序列进入 reducer，不能绕过流式事件处理直接写入视图。
    store
      .getState()
      .applyEvents([
        {
          ...event,
          provider: "codex",
          version: 2,
          sessionId: "session-1",
          sequence: ++sequence,
          timestamp: "2026-11-10T00:00:00Z",
        } as AgentEvent,
      ]);
  });
  const readThought = () =>
    store
      .getState()
      .reconstructSnapshot()
      ?.turns.find((turn) => turn.id === "turn-running")
      ?.items.find((item) => item.type === "reasoning");
  projection.update({
    sessionUpdate: "agent_thought_chunk",
    messageId: "thought",
    content: { type: "text", text: "先检查" },
  });
  expect(readThought()).toMatchObject({ summary: "先检查", content: "" });
  projection.update({
    sessionUpdate: "agent_thought_chunk",
    messageId: "thought",
    content: { type: "text", text: "已有代码" },
  });
  expect(readThought()).toMatchObject({ summary: "先检查已有代码", content: "" });
  projection.finish("end_turn");
  expect(readThought()).toMatchObject({ summary: "先检查已有代码", content: "" });
});
