import { describe, expect, it } from "vitest";
import type { AgentProviderEvent } from "@codexly/core";
import { AcpEventProjection } from "./event-projection.js";

function fixture() {
  const events: AgentProviderEvent[] = [];
  const projection = new AcpEventProjection("task", "turn", (event) => {
    events.push(event);
  });
  return { projection, events };
}

describe("ACP 增量事件投影", () => {
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
      sessionUpdate: "tool_call",
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
      content: { type: "text", text: "思考" },
    });
    projection.update({
      sessionUpdate: "plan",
      entries: [{ content: "实现", priority: "high", status: "in_progress" }],
    });
    projection.update({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "部分回答" },
    });
    const turn = projection.finish("cancelled");
    expect(turn.status).toBe("interrupted");
    expect(turn.items.some((item) => item.type === "reasoning" && item.content === "思考")).toBe(
      true,
    );
    expect(turn.items.some((item) => item.type === "message" && item.text === "部分回答")).toBe(
      true,
    );
    expect(events.find((event) => event.type === "plan.updated")?.payload.plan.steps).toEqual([
      { text: "实现", status: "in_progress" },
    ]);
  });

  it("无 messageId 时连续正文合并，工具分隔后的文字创建新条目", () => {
    const { projection } = fixture();
    for (const text of ["A", "B"])
      projection.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
    projection.update({
      sessionUpdate: "tool_call",
      toolCallId: "t",
      title: "工具",
      status: "completed",
    });
    projection.update({
      sessionUpdate: "agent_message_chunk",
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
        content: { type: "text", text: "迟到" },
      });
    }).toThrow("结束");
  });
});
