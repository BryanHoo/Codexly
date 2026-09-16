import { describe, expect, it } from "vitest";

import { resolveHistoryTarget } from "./history-target.js";

const location = {
  itemId: "old-item",
  projectId: "codexly",
  query: "关键词 另一个词",
  snippet: "唯一的关键词片段",
  snippetMatchRange: { end: 6, start: 3 },
  taskId: "task-1",
  turnCursor: "cursor",
  turnId: "turn-1",
};

describe("resolveHistoryTarget", () => {
  it("优先使用稳定 Item ID，并在唯一片段匹配时重新绑定", () => {
    const snapshot = {
      turns: [
        {
          completedAt: null,
          error: null,
          id: "turn-1",
          items: [
            {
              id: "new-item",
              role: "assistant" as const,
              text: "这是唯一的关键词片段",
              type: "message" as const,
            },
          ],
          startedAt: null,
          status: "completed" as const,
        },
      ],
    };

    expect(resolveHistoryTarget(snapshot, location)).toMatchObject({
      highlightText: "关键词",
      itemId: "new-item",
    });
    expect(resolveHistoryTarget(snapshot, { ...location, itemId: "new-item" })).toEqual({
      ...location,
      highlightText: "关键词",
      itemId: "new-item",
    });
  });

  it("存在多个片段候选时不猜测目标", () => {
    const message = {
      role: "assistant" as const,
      text: "唯一的关键词片段",
      type: "message" as const,
    };
    const snapshot = {
      turns: [
        {
          completedAt: null,
          error: null,
          id: "turn-1",
          items: [
            { ...message, id: "item-1" },
            { ...message, id: "item-2" },
          ],
          startedAt: null,
          status: "completed" as const,
        },
      ],
    };

    expect(resolveHistoryTarget(snapshot, location)).toBeNull();
  });
});
