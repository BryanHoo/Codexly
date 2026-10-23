import { describe, expect, it } from "vitest";
import { resolvePromptCommandTrigger } from "./prompt-trigger.js";

describe("prompt command trigger", () => {
  it.each(["/", "#"])("recognizes %s and titles including spaces at the cursor", (trigger) => {
    expect(resolvePromptCommandTrigger(trigger, 1)).toMatchObject({ start: 0, end: 1, query: "" });
    const draft = `前文 ${trigger}Code Review 后文`;
    expect(resolvePromptCommandTrigger(draft, 15)).toMatchObject({
      start: 3,
      end: 15,
      query: "Code Review",
    });
    expect(resolvePromptCommandTrigger(`说明\n${trigger}代码检查`, 8)).toMatchObject({
      start: 3,
      end: 8,
      query: "代码检查",
    });
  });

  it.each([
    "说明#检查",
    "foo/bar",
    "https://example.com/#anchor",
    "# 标题",
    "/check ",
    "#检查\n其他",
  ])("ignores ordinary text and markdown: %s", (draft) => {
    expect(resolvePromptCommandTrigger(draft, draft.length)).toBeNull();
  });

  it("uses the nearest trigger and rejects invalid cursor offsets", () => {
    expect(resolvePromptCommandTrigger("/review #检查", 11)).toMatchObject({
      start: 8,
      query: "检查",
    });
    expect(resolvePromptCommandTrigger("#检查", -1)).toBeNull();
    expect(resolvePromptCommandTrigger("#检查", 4)).toBeNull();
  });
});
