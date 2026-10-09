import type { AgentItem } from "@/protocol/index.js";
import { describe, expect, it } from "vitest";

import { createTaskItemStore } from "../../conversation/runtime/task-store.js";
import { resolveCompletedTurnProcessItemIds } from "./task-timeline-process.js";
import { groupStoredTurnTimelineItems } from "./task-timeline-store-items.js";

describe("completed turn process projection", () => {
  it("keeps partial answers visible when a later final answer completes the turn", () => {
    const items = [
      {
        id: "partial",
        type: "message",
        role: "assistant",
        phase: "partial_answer",
        text: "第一部分",
      },
      { id: "progress", type: "message", role: "assistant", phase: "commentary", text: "继续检查" },
      { id: "final", type: "message", role: "assistant", phase: "final_answer", text: "检查完成" },
    ] as const;
    expect(resolveCompletedTurnProcessItemIds(items, "running")).toEqual([]);
    expect(resolveCompletedTurnProcessItemIds(items, "completed")).toEqual(["progress"]);
  });
  it.each(["interrupted", "failed"] as const)("collapses all %s output only after another submission", (status) => {
    const items: AgentItem[] = [
      { id: "input", type: "message", role: "user", text: "Request" },
      { id: "partial", type: "message", role: "assistant", phase: "final_answer", text: "Partial" },
      { id: "changes", type: "file_change", status: "completed", changes: [] },
    ];
    expect(resolveCompletedTurnProcessItemIds(items, status, false)).toEqual([]);
    expect(resolveCompletedTurnProcessItemIds(items, status, true)).toEqual(["partial", "changes"]);
    expect(resolveCompletedTurnProcessItemIds(items, "running", true)).toEqual([]);
  });

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
