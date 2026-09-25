import type { AgentItem } from "@/protocol/index.js";
import { describe, expect, it } from "vitest";

import { createTaskItemStore } from "../../conversation/runtime/task-store.js";
import { resolveCompletedTurnProcessItemIds } from "./task-timeline-process.js";
import { groupStoredTurnTimelineItems } from "./task-timeline-store-items.js";

describe("completed turn process projection", () => {
  it("collapses an in-turn steer and keeps the final file review with the answer", () => {
    const items: AgentItem[] = [
      { id: "initial-user", role: "user", text: "Fix the issue", type: "message" },
      {
        id: "commentary-before-steer",
        phase: "commentary",
        role: "assistant",
        text: "Running checks",
        type: "message",
      },
      { changes: [], id: "file-change", status: "completed", type: "file_change" },
      { id: "reasoning", text: "检查变更", type: "reasoning" },
      { id: "user-steer", role: "user", text: "Do not publish", type: "message" },
      {
        id: "commentary-after-steer",
        phase: "commentary",
        role: "assistant",
        text: "Continuing locally",
        type: "message",
      },
      {
        id: "final-answer",
        phase: "final_answer",
        role: "assistant",
        text: "Done",
        type: "message",
      },
    ];
    const itemStoresByKey = new Map(
      items.map((item) => [item.id, createTaskItemStore(item)] as const),
    );
    const processItemIds = new Set(resolveCompletedTurnProcessItemIds(items, "completed"));

    expect(processItemIds).toEqual(
      new Set(["commentary-before-steer", "reasoning", "user-steer", "commentary-after-steer"]),
    );
    expect(groupStoredTurnTimelineItems(items.map((item) => item.id), itemStoresByKey, processItemIds))
      .toEqual([
        { itemKey: "initial-user", type: "user" },
        {
          itemKeys: ["file-change", "final-answer"],
          key: "file-change",
          type: "assistant",
        },
      ]);
  });
});
