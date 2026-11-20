import { describe, expect, it } from "vitest";
import { isInlineFileChangeVisible, resolveFinalAnswerIndex } from "./turn-process.js";

it("最终答复阶段优先，ACP 缺少阶段时回退末条助手消息并排除异步问题", () => {
  const message = { type: "message", role: "assistant" };
  expect(resolveFinalAnswerIndex([message, { type: "tool" }, message], true)).toBe(2);
  expect(resolveFinalAnswerIndex([{ ...message, phase: "final_answer" }, message])).toBe(0);
  expect(resolveFinalAnswerIndex([message, { ...message, questions: [{}] }], true)).toBe(0);
  expect(resolveFinalAnswerIndex([{ ...message, phase: "commentary" }, { type: "tool" }])).toBe(-1);
});

describe("inline file change visibility", () => {
  it.each(["completed", "interrupted", "failed"])(
    "leaves completed file edits to the final summary when the turn is %s",
    (turnStatus) => {
      expect(isInlineFileChangeVisible("completed", turnStatus)).toBe(false);
    },
  );

  it("keeps edits visible while the turn is running", () => {
    for (const status of ["pending", "running", "completed"]) {
      expect(isInlineFileChangeVisible(status, "running")).toBe(true);
    }
    expect(isInlineFileChangeVisible("failed", "running")).toBe(false);
  });
});
