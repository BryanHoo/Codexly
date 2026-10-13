import { describe, expect, it, vi } from "vitest";
import { createFollowupDraftAction } from "./followup-draft.js";
import type { PromptDocumentPart } from "@codexly/protocol";

describe("后续建议草稿", () => {
  it("读取点击时的最新内容并保留已有草稿", () => {
    let draft: readonly PromptDocumentPart[] = [];
    const replace = vi.fn();
    const focus = vi.fn();
    const action = createFollowupDraftAction({
      disabled: false,
      read: () => draft,
      replace,
      focus,
    });
    draft = [{ type: "text", text: "已有要求" }];
    action("继续制作图表");
    expect(replace).toHaveBeenCalledExactlyOnceWith([
      ...draft,
      { type: "text", text: "\n\n继续制作图表" },
    ]);
    expect(focus).toHaveBeenCalledOnce();
  });
  it.each([true, false])("禁用或空建议不改写输入，禁用=%s", (disabled) => {
    const replace = vi.fn();
    const focus = vi.fn();
    const action = createFollowupDraftAction({ disabled, read: () => [], replace, focus });
    action(disabled ? "继续" : "  ");
    expect(replace).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });
});
