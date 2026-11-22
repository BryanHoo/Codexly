import { describe, expect, it } from "vitest";
import type { AgentProviderEvent } from "@codexly/core";
import { AcpEventProjection } from "./event-projection.js";
import { AgentTurnSchema } from "@codexly/protocol";
import { Value } from "@sinclair/typebox/value";

function fixture() {
  const events: AgentProviderEvent[] = [];
  const projection = new AcpEventProjection("task", "turn", (event) => {
    events.push(event);
  });
  return { projection, events };
}

it("工具结束时的文字摘要保留此前分块报告的文件差异", () => {
  const { projection } = fixture();
  projection.update({
    sessionUpdate: "tool_call_update",
    toolCallId: "edit",
    content: [{ type: "diff", path: "/repo/a.ts", oldText: "old", newText: "new" }],
  });
  projection.update({
    sessionUpdate: "tool_call_update",
    toolCallId: "edit",
    status: "completed",
    content: [{ type: "content", content: { type: "text", text: "Edited a.ts" } }],
  });
  const files = projection.finish("end_turn").items.find((item) => item.type === "file_change");
  expect(files?.changes[0]?.path).toBe("/repo/a.ts");
  expect(files?.changes[0]?.diff).toContain("+new");
});

describe("ACP 增量事件投影", () => {
  it("将当前上下文用量映射到共享事件，保留下降和归零，不混入费用", () => {
    const { projection, events } = fixture();
    for (const used of [53000, 12000, 0]) {
      projection.update({
        sessionUpdate: "usage_update",
        used,
        size: 200000,
        cost: { amount: 1, currency: "USD" },
      });
    }
    expect(events).toEqual(
      [53000, 12000, 0].map((usedTokens) => ({
        type: "usage.updated",
        taskId: "task",
        turnId: "turn",
        payload: { usage: { usedTokens, contextWindow: 200000 } },
      })),
    );
    projection.update({ sessionUpdate: "usage_update", used: 0, size: 0 });
    expect(events.at(-1)?.payload).toEqual({ usage: { usedTokens: 0, contextWindow: null } });
    expect(projection.snapshot().items).toEqual([]);
  });

  it.each([
    ["end_turn", "completed"],
    ["refusal", "completed"],
    ["max_tokens", "interrupted"],
    ["max_turn_requests", "interrupted"],
    ["cancelled", "interrupted"],
  ] as const)("保留 %s 原因，聊天展示为 %s", (reason, status) => {
    const { projection, events } = fixture();
    const turn = projection.finish(reason);
    expect(turn).toMatchObject({ status, stopReason: reason });
    expect(Value.Check(AgentTurnSchema, turn)).toBe(true);
    expect(events.at(-1)).toMatchObject({ payload: { turn: { stopReason: reason } } });
    // 迟到的结束通知不得覆盖先前已确定的停止原因。
    expect(projection.finish("end_turn")).toEqual(turn);
  });

  it("相同 messageId 合并增量，不修改已交付的开始事件", () => {
    const { projection, events } = fixture();
    projection.update({
      sessionUpdate: "agent_message_chunk",
      messageId: "m",
      content: { type: "text", text: "你" },
    });
    const started = structuredClone(events[0]);
    projection.update({
      sessionUpdate: "agent_message_chunk",
      messageId: "m",
      content: { type: "text", text: "好" },
    });
    const turn = projection.finish("end_turn");
    expect(turn.items).toEqual([
      { id: "acp:message:assistant:m", role: "assistant", type: "message", text: "你好" },
    ]);
    expect(events[0]).toEqual(started);
    expect(
      events.filter((event) => event.type === "message.delta").map((event) => event.payload.delta),
    ).toEqual(["你", "好"]);
    expect(events.at(-1)?.type).toBe("turn.completed");
  });

  it("工具保留 ACP 输入、输出和状态，局部更新不丢失已有字段", () => {
    const { projection } = fixture();
    projection.update({
      sessionUpdate: "tool_call_update",
      toolCallId: "t",
      title: "读取文件",
      status: "in_progress",
      rawInput: { path: "a.ts" },
    });
    projection.update({
      sessionUpdate: "tool_call_update",
      toolCallId: "t",
      rawOutput: { content: "正文" },
      status: "completed",
    });
    expect(projection.finish("end_turn").items).toEqual([
      {
        id: "acp:tool:t",
        type: "tool",
        name: "读取文件",
        status: "completed",
        input: { path: "a.ts" },
        output: { content: "正文" },
      },
    ]);
  });

  it("推理、消息和计划独立更新，取消保留已收到的正文", () => {
    const { projection, events } = fixture();
    projection.update({
      sessionUpdate: "agent_thought_chunk",
      messageId: "test-message",
      content: { type: "text", text: "思考" },
    });
    projection.update({
      sessionUpdate: "plan_update",
      plan: {
        type: "items",
        planId: "test-plan",
        entries: [{ content: "实现", priority: "high", status: "in_progress" }],
      },
    });
    projection.update({
      sessionUpdate: "agent_message_chunk",
      messageId: "test-message",
      content: { type: "text", text: "部分回答" },
    });
    expect(events.find((event) => event.type === "reasoning.delta")?.payload).toEqual({
      delta: "思考",
      field: "summary",
    });
    const turn = projection.finish("cancelled");
    expect(turn.status).toBe("interrupted");
    expect(
      turn.items.some(
        (item) => item.type === "reasoning" && item.summary === "思考" && item.content === "",
      ),
    ).toBe(true);
    expect(turn.items.some((item) => item.type === "message" && item.text === "部分回答")).toBe(
      true,
    );
    expect(events.find((event) => event.type === "plan.updated")?.payload.plan.steps).toEqual([
      { text: "实现", status: "in_progress" },
    ]);
  });

  it("相同消息 ID 合并分块，新 ID 创建新条目", () => {
    const { projection } = fixture();
    for (const text of ["A", "B"])
      projection.update({
        sessionUpdate: "agent_message_chunk",
        messageId: "test-message",
        content: { type: "text", text },
      });
    projection.update({
      sessionUpdate: "tool_call_update",
      toolCallId: "t",
      title: "工具",
      status: "completed",
    });
    projection.update({
      sessionUpdate: "agent_message_chunk",
      messageId: "new-message",
      content: { type: "text", text: "C" },
    });
    expect(
      projection
        .finish("end_turn")
        .items.filter((item) => item.type === "message")
        .map((item) => item.text),
    ).toEqual(["AB", "C"]);
  });

  it("快照隔离与终态幂等，失败保留已显示内容", () => {
    const { projection, events } = fixture();
    projection.update({
      sessionUpdate: "agent_message_chunk",
      messageId: "m",
      content: { type: "text", text: "A" },
    });
    const before = projection.snapshot();
    projection.update({
      sessionUpdate: "agent_message_chunk",
      messageId: "m",
      content: { type: "text", text: "B" },
    });
    expect(before.items[0]).toMatchObject({ text: "A" });
    expect(projection.fail("断线").status).toBe("failed");
    const count = events.length;
    expect(projection.finish("end_turn").error).toBe("断线");
    expect(events).toHaveLength(count);
    expect(() => {
      projection.update({
        sessionUpdate: "agent_message_chunk",
        messageId: "test-message",
        content: { type: "text", text: "迟到" },
      });
    }).toThrow("结束");
  });
});

it("v1 工具创建事件立即投影，并保留清空文件的修改语义", () => {
  const { projection } = fixture();
  projection.update({
    sessionUpdate: "tool_call",
    toolCallId: "edit",
    title: "编辑",
    status: "in_progress",
    content: [{ type: "diff", path: "/a", oldText: "old", newText: "" }],
  });
  const files = projection.finish("end_turn").items.find((item) => item.type === "file_change");
  expect(files?.changes[0]?.kind).toBe("update");
  expect(files?.changes[0]?.diff).toContain("-old");
});

it("按首次出现的位置保留压缩，支持分块追加、完整替换和清空", () => {
  const { projection, events } = fixture();
  const chunk = (text: string) => {
    projection.update({
      sessionUpdate: "compaction_summary_chunk",
      compactionId: "compact",
      content: { type: "text", text },
    });
  };
  chunk("早期");
  projection.update({
    sessionUpdate: "agent_message_chunk",
    messageId: "answer",
    content: { type: "text", text: "继续" },
  });
  chunk("摘要");
  expect(projection.snapshot().items[0]).toMatchObject({
    status: "in_progress",
    summary: "早期摘要",
  });
  projection.update({
    sessionUpdate: "compaction_update",
    compactionId: "compact",
    status: "completed",
    summary: [{ type: "text", text: "最终" }],
  });
  chunk("摘要");
  expect(projection.snapshot().items.map((item) => item.type)).toEqual(["compaction", "message"]);
  expect(projection.snapshot().items[0]).toMatchObject({
    status: "completed",
    summary: "最终摘要",
  });
  projection.update({
    sessionUpdate: "compaction_update",
    compactionId: "compact",
    status: "completed",
    summary: null,
  });
  const turn = projection.finish("end_turn");
  expect(turn.items[0]).toMatchObject({ status: "completed", summary: "" });
  expect(Value.Check(AgentTurnSchema, turn)).toBe(true);
  expect(events[0]).toMatchObject({ type: "item.started", itemId: "acp:compaction:compact" });
});
