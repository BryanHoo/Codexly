import { describe, expect, it } from "vitest";
import type { AgentProviderEvent } from "@codexly/core";
import { ClaudeTurnProjection } from "./turn-projection.js";

function setup() {
  const events: AgentProviderEvent[] = [];
  const turn = new ClaudeTurnProjection(
    "task",
    "turn",
    "检查项目",
    (event) => events.push(event),
    undefined,
    true,
  );
  const say = (id: string, texts: string[]) => {
    turn.receive({
      type: "assistant",
      message: { id, content: texts.map((text) => ({ type: "text", text })) },
    });
  };
  say("progress", ["正在读取项目。"]);
  turn.receive({
    type: "assistant",
    message: {
      id: "call",
      content: [
        { type: "tool_use", id: "read", name: "Read", input: { file_path: "package.json" } },
      ],
    },
  });
  turn.receive({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "read", content: "配置内容" }] },
  });
  return { turn, events, say };
}

describe("Claude completed reply process", () => {
  it("collapses live commentary and tools while preserving every final text block", () => {
    const { turn, events, say } = setup();
    say("answer", ["检查完成。", "无需修改。"]);
    expect(turn.snapshot().items).not.toContainEqual(
      expect.objectContaining({ phase: "final_answer" }),
    );
    turn.receive({ type: "result", subtype: "success", result: "检查完成。无需修改。" });
    expect(
      turn.snapshot().items.filter((item) => item.type === "message" && item.role === "assistant"),
    ).toMatchObject([
      { id: "progress:0", phase: "commentary" },
      { id: "answer:0", phase: "final_answer" },
      { id: "answer:1", phase: "final_answer" },
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "turn.completed",
      payload: { turn: { items: turn.snapshot().items } },
    });
    expect(turn.changes.pendingItems()).toContainEqual(
      expect.objectContaining({ id: "answer:0", phase: "final_answer" }),
    );
  });

  it.each(["failed", "interrupted"] as const)(
    "does not promote incomplete text on %s",
    (status) => {
      const { turn, say } = setup();
      say("partial", ["只完成部分检查。"]);
      turn.finish(status);
      expect(turn.snapshot().items).not.toContainEqual(
        expect.objectContaining({ phase: "final_answer" }),
      );
    },
  );

  it("does not promote commentary when a successful turn ends with a tool", () => {
    const { turn } = setup();
    turn.receive({ type: "result", subtype: "success", result: "" });
    expect(turn.snapshot().items).not.toContainEqual(
      expect.objectContaining({ phase: "final_answer" }),
    );
  });

  it("keeps structured output as the result and folds earlier text", () => {
    const { turn, say } = setup();
    say("draft", ["正在整理结构化结果。"]);
    turn.receive({ type: "result", subtype: "success", structured_output: { ok: true } });
    expect(turn.snapshot().items).toContainEqual(
      expect.objectContaining({ id: "draft:0", phase: "commentary" }),
    );
    expect(turn.snapshot().items.at(-1)).toMatchObject({
      phase: "final_answer",
      text: '{"ok":true}',
    });
  });

  it("marks a plain result fallback as the final answer", () => {
    const turn = new ClaudeTurnProjection("task", "turn", "你好", () => undefined);
    turn.receive({ type: "result", subtype: "success", result: "你好。" });
    expect(turn.snapshot().items.at(-1)).toMatchObject({ phase: "final_answer", text: "你好。" });
  });
});
