import { describe, expect, it, vi } from "vitest";

import {
  getTaskTimelineNavigationItems,
  getUserMessageNavigationPreview,
} from "./timeline-navigation.js";

describe("共享时间线索引", () => {
  it("按回合键顺序读取，跳过缺失条目与无预览消息", () => {
    const getPreview = vi.fn((item: string) => (item === "assistant" ? null : item));
    const items = getTaskTimelineNavigationItems(
      {
        turnIds: ["first", "empty", "second"],
        itemKeysByTurnId: { first: ["user", "missing", "assistant"], second: ["review"] },
        itemStoresByKey: new Map([
          ["review", { peek: () => "localized review" }],
          ["assistant", { peek: () => "assistant" }],
          ["user", { peek: () => "user text" }],
        ]),
      },
      getPreview,
    );

    expect(items).toEqual([
      { anchorId: "user", preview: "user text", turnIndex: 0 },
      { anchorId: "review", preview: "localized review", turnIndex: 2 },
    ]);
    expect(getPreview).toHaveBeenCalledTimes(3);
  });

  it("保留附件消息、Skill 与正文的可见顺序", () => {
    expect(
      getUserMessageNavigationPreview({
        text: "",
        skills: [{ name: "review" }],
        attachments: [{ name: "参考图.png" }],
      }),
    ).toBe("$review\n参考图.png");
    expect(getUserMessageNavigationPreview({ text: "  原文\n" })).toBe("  原文\n");
  });
});
