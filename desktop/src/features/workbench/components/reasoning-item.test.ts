import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";

import { createTaskItemStore, type TaskStore } from "../../conversation/runtime/task-store.js";
import { TimelineItemContent } from "./task-timeline-items.js";
import { StoredAssistantTimelineItems } from "./task-timeline-store-operation-groups.js";
import { filterRenderableTimelineItemKeys, groupConsecutiveTimelineOperations } from "./task-timeline-operation-groups.js";

const props = {
  onOpenFileDiff: () => undefined,
  onOpenSourceFile: () => undefined,
  projectId: "project",
  taskId: "task",
};

describe("empty reasoning summaries", () => {
  it.each(["", " \n\t\r ", "\u3000\u00a0"])("hides empty summary %j in every turn state", (text) => {
    for (const turnStatus of ["running", "completed", "interrupted", "failed"] as const) {
      expect(renderToStaticMarkup(createElement(TimelineItemContent, {
        ...props,
        isLastTurnItem: true,
        item: { id: "reasoning", text, type: "reasoning" },
        turnStatus,
      }))).toBe("");
    }
  });

  it("does not leave anchors or a collapsible group for empty summaries", () => {
    const itemStoresByKey = new Map(["", " \n "].map((text, index) => [
      `reasoning-${index}`,
      createTaskItemStore({ id: `reasoning-${index}`, text, type: "reasoning" }),
    ]));
    const store = createStore(() => ({ itemStoresByKey })) as unknown as TaskStore;
    expect(renderToStaticMarkup(createElement(StoredAssistantTimelineItems, {
      ...props,
      itemKeys: [...itemStoresByKey.keys()],
      lastTurnItemKey: "reasoning-1",
      store,
      turnStatus: "running",
    }))).toBe("");
  });

  it("restores a summary after text arrives without reading unrelated output", () => {
    const reasoning = createTaskItemStore({ id: "reasoning", text: " \n", type: "reasoning" });
    const tool = createTaskItemStore({ id: "tool", name: "search", status: "completed", type: "tool" });
    const stores = new Map([["reasoning", reasoning], ["tool", tool]]);
    const keys = [...stores.keys()];
    // 非推理 Item 的正文读取在分组过滤中没有必要，直接设为失败以锁定此边界。
    tool.read = () => { throw new Error("must not read unrelated output"); };
    const groups = () => groupConsecutiveTimelineOperations(
      filterRenderableTimelineItemKeys(keys, stores), (key) => stores.get(key)?.peek(),
    );
    expect(groups()).toEqual([{ itemKey: "tool", type: "item" }]);
    reasoning.appendDelta({
      version: 2, provider: "codex", taskId: "task", turnId: "turn", itemId: "reasoning",
      sequence: 1, sessionId: "session", timestamp: "2026-10-20T00:00:00Z",
      type: "reasoning.delta", payload: { delta: "检查文件" },
    });
    reasoning.publish();
    expect(groups()).toEqual([{
      itemKeys: ["reasoning", "tool"], key: "reasoning", type: "operation_group",
    }]);
    reasoning.replace({ id: "reasoning", text: "", type: "reasoning" });
    reasoning.publish();
    expect(groups()).toEqual([{ itemKey: "tool", type: "item" }]);
  });
});
