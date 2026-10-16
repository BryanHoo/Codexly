import { describe, expect, it } from "vitest";
import { ClaudeTurnProjection } from "./turn-projection.js";
import type { AgentProviderEvent } from "@codexly/core";

describe("Claude streaming projection", () => {
  it("reconciles partial text with the final message and waits for result to complete", () => {
    const events: AgentProviderEvent[] = [];
    const turn = new ClaudeTurnProjection("task", "turn", "你好", (event) => events.push(event));
    turn.receive({
      type: "stream_event",
      event: { type: "message_start", message: { id: "msg" } },
    });
    turn.receive({
      type: "stream_event",
      event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    });
    turn.receive({
      type: "stream_event",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "回答" } },
    });
    turn.receive({
      type: "assistant",
      message: { id: "msg", content: [{ type: "text", text: "回答" }] },
    });
    expect(turn.snapshot().status).toBe("running");
    expect(
      turn.snapshot().items.filter((item) => item.type === "message" && item.role === "assistant"),
    ).toEqual([{ id: "msg:0", type: "message", role: "assistant", text: "回答" }]);
    turn.receive({ type: "result", subtype: "success", result: "回答", is_error: false });
    expect(turn.snapshot().status).toBe("completed");
    expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
    turn.receive({ type: "result", subtype: "success", result: "回答" });
    expect(events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
  });

  it("keeps tool call identity, tool failures and reasoning separate from assistant text", () => {
    const turn = new ClaudeTurnProjection("task", "turn", "读取文件", () => undefined);
    turn.receive({
      type: "assistant",
      message: {
        id: "msg",
        content: [
          { type: "thinking", thinking: "先检查路径" },
          { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "/tmp/test" } },
        ],
      },
    });
    turn.receive({
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "tool-1", content: "找不到文件", is_error: true },
        ],
      },
    });
    expect(turn.snapshot().items).toContainEqual({
      id: "tool-1",
      type: "tool",
      name: "Read",
      input: { file_path: "/tmp/test" },
      output: "找不到文件",
      status: "failed",
    });
    expect(turn.snapshot().items).toContainEqual({
      id: "msg:0",
      type: "reasoning",
      content: "先检查路径",
      summary: "",
    });
    turn.receive({
      type: "result",
      subtype: "error_during_execution",
      errors: ["API unavailable"],
    });
    expect(turn.snapshot()).toMatchObject({ status: "failed", error: "API unavailable" });
  });

  it("treats stream exhaustion as failure and cancellation as interrupted, never as success", () => {
    const failed = new ClaudeTurnProjection("t", "a", "hello", () => undefined);
    failed.finish("failed", "Claude stream ended without a result");
    expect(failed.snapshot()).toMatchObject({
      status: "failed",
      error: "Claude stream ended without a result",
    });
    const interrupted = new ClaudeTurnProjection("t", "b", "hello", () => undefined);
    interrupted.finish("interrupted");
    interrupted.receive({ type: "result", subtype: "success", result: "late" });
    expect(interrupted.snapshot().status).toBe("interrupted");
  });
});

it("finishes pending tool visuals when the turn is interrupted", () => {
  const projection = new ClaudeTurnProjection("task", "turn", "prompt", () => undefined);
  projection.receive({
    type: "assistant",
    message: {
      id: "message",
      content: [{ type: "tool_use", id: "tool", name: "Write", input: {} }],
    },
  });
  projection.finish("interrupted");
  expect(projection.snapshot().items.find((item) => item.id === "tool")).toMatchObject({
    status: "failed",
  });
});
