import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";

import { createTaskItemKey, createTaskStore } from "../../conversation/runtime/task-store.js";
import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";
import {
  TaskTimelineNavigation,
  getTaskTimelineNavigationItems,
} from "./task-timeline-navigation.js";
import { completedTurn, renderToStaticMarkup, snapshot } from "./task-timeline.test-support.js";

describe("task timeline navigation", () => {
  it("extracts every user-visible message in timeline order", () => {
    const navigationSnapshot: RuntimeTaskSnapshot = {
      ...snapshot,
      turns: [
        {
          ...completedTurn,
          id: "turn-first",
          items: [
            {
              attachments: [
                {
                  id: "attachment-layout",
                  kind: "image",
                  mediaType: "image/png",
                  name: "layout.png",
                  size: 68,
                },
              ],
              id: "message-first",
              role: "user",
              skills: [{ name: "frontend-design" }],
              text: "先分析入口",
              type: "message",
            },
            {
              id: "message-assistant",
              role: "assistant",
              text: "正在分析。",
              type: "message",
            },
            {
              id: "message-follow-up",
              role: "user",
              text: "再检查滚动行为",
              type: "message",
            },
          ],
        },
        {
          ...completedTurn,
          id: "turn-review",
          items: [
            {
              id: "review-request",
              target: { type: "uncommitted_changes" },
              type: "review",
            },
          ],
        },
      ],
    };
    const store = createTaskStore(
      { projectId: navigationSnapshot.projectId, taskId: navigationSnapshot.id },
      {
        checkpoint: { sequence: 0, sessionId: "navigation-test" },
        snapshot: navigationSnapshot,
      },
    );

    expect(getTaskTimelineNavigationItems(store.getState())).toEqual([
      {
        anchorId: createTaskItemKey("turn-first", "message-first"),
        preview: "$frontend-design\n先分析入口\nlayout.png",
        turnIndex: 0,
      },
      {
        anchorId: createTaskItemKey("turn-first", "message-follow-up"),
        preview: "再检查滚动行为",
        turnIndex: 0,
      },
      {
        anchorId: createTaskItemKey("turn-review", "review-request"),
        preview: "请检查我未提交的更改",
        turnIndex: 1,
      },
    ]);
  });

  it("does not render navigation for a single user message", () => {
    const markup = renderToStaticMarkup(
      <TaskTimelineNavigation
        items={[{ anchorId: "turn-1:message-1", preview: "唯一消息", turnIndex: 0 }]}
        onNavigate={vi.fn()}
        scrollContainerRef={createRef<HTMLDivElement>()}
        scrollbarWidth={0}
      />,
    );

    expect(markup).toBe("");
  });

  it("renders one accessible navigation control for every message", () => {
    const markup = renderToStaticMarkup(
      <TaskTimelineNavigation
        items={[
          { anchorId: "turn-1:message-1", preview: "第一条消息", turnIndex: 0 },
          { anchorId: "turn-2:message-2", preview: "第二条消息", turnIndex: 1 },
        ]}
        onNavigate={vi.fn()}
        scrollContainerRef={createRef<HTMLDivElement>()}
        scrollbarWidth={0}
      />,
    );

    expect(markup).toContain('aria-label="用户消息快捷导航"');
    expect(markup).toContain('aria-label="跳转到用户消息 1"');
    expect(markup).toContain('aria-label="跳转到用户消息 2"');
    expect(markup.match(/data-timeline-navigation-item=/g)).toHaveLength(2);
  });
});
