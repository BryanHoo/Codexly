import { describe, expect, it, vi } from "vitest";
import { createMessageEditDraftAction } from "./message-edit-draft.js";

describe("用户消息编辑草稿", () => {
  it("保留原消息和空白，只回填新草稿并聚焦，不自动发送", () => {
    const message = Object.freeze({ text: "  原消息\n第二行  ", skills: [{ name: "missing" }] });
    const replace = vi.fn();
    const focus = vi.fn();
    const edit = createMessageEditDraftAction({ disabled: false, skills: [], replace, focus });
    edit(message);
    expect(replace).toHaveBeenCalledExactlyOnceWith([
      { type: "text", text: "$missing" },
      { type: "text", text: " " },
      { type: "text", text: message.text },
    ]);
    expect(focus).toHaveBeenCalledOnce();
    expect(message.text).toBe("  原消息\n第二行  ");
  });

  it("恢复仍可用的技能令牌，支持只有技能的消息并忽略附件空消息", () => {
    const skill = {
      id: "skill-id",
      name: "review",
      displayName: "Review",
      description: "审查",
      scope: "system" as const,
    };
    const replace = vi.fn();
    const focus = vi.fn();
    const edit = createMessageEditDraftAction({ disabled: false, skills: [skill], replace, focus });
    edit({ text: "", skills: [{ name: "review" }] });
    expect(replace).toHaveBeenCalledExactlyOnceWith([{ type: "skill", skill }]);
    edit({ text: "" });
    expect(replace).toHaveBeenCalledOnce();
  });

  it("锁定时不回填，也不抢占焦点", () => {
    const replace = vi.fn();
    const focus = vi.fn();
    createMessageEditDraftAction({ disabled: true, skills: [], replace, focus })({
      text: "原消息",
    });
    expect(replace).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });
});
