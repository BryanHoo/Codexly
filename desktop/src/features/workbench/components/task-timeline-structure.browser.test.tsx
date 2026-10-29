import { StrictMode } from "react";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { TaskStoreTimeline } from "./task-timeline-store.js";
import { createTaskStore as createWebTaskStore } from "../../../../../apps/web/src/features/conversation/runtime/task-store.js";
import { TaskStoreTimeline as WebTaskStoreTimeline } from "../../../../../apps/web/src/features/workbench/components/task-timeline-store.js";

const timestamp = "2026-10-29T00:00:00Z";
const actions = {
  onOpenFileDiff: () => undefined,
  onOpenSourceFile: () => undefined,
  onReviewFileChanges: () => undefined,
  onResolvePendingRequest: async () => undefined,
};

function response(engine: "codex" | "claude") {
  return {
    checkpoint: { sequence: 0, sessionId: "session" },
    snapshot: {
      id: "task",
      projectId: "project",
      title: "Task",
      pinned: false,
      engine,
      updatedAt: timestamp,
      status: "running" as const,
      pendingRequests: [],
      turnsNextCursor: null,
      contextUsage: null,
      goal: null,
      plan: null,
      settings: {
        approvalPolicy: "on-request" as const,
        approvalsReviewer: "user" as const,
        model: "model",
        reasoningEffort: "high" as const,
        sandboxMode: "workspace-write" as const,
      },
      turns: ["history", "latest"].map((id) => ({
        id,
        status: "completed" as const,
        startedAt: timestamp,
        completedAt: timestamp,
        error: null,
        items: [
          { id: `${id}-user`, type: "message" as const, role: "user" as const, text: `输入 ${id}` },
          {
            id: `${id}-reply`,
            type: "message" as const,
            role: "assistant" as const,
            text: `答复 ${id}`,
          },
        ],
      })),
    },
  };
}

const platforms = [
  {
    name: "desktop",
    create(engine: "codex" | "claude") {
      const store = createTaskStore({ projectId: "project", taskId: "task" }, response(engine));
      return { store, element: <TaskStoreTimeline connected store={store} {...actions} /> };
    },
  },
  {
    name: "web",
    create(engine: "codex" | "claude") {
      const store = createWebTaskStore({ projectId: "project", taskId: "task" }, response(engine));
      return { store, element: <WebTaskStoreTimeline connected store={store} {...actions} /> };
    },
  },
];

for (const platform of platforms) {
  it.each(["codex", "claude"] as const)(
    `${platform.name}: %s 新结构不再读取未变化历史的正文`,
    async (engine) => {
      const { store, element } = platform.create(engine);
      const historyItemStore = [...store.getState().itemStoresByKey.values()].find(
        (item) => item.peek().id === "history-reply",
      )!;
      // read 是历史助手正文与文件变更聚合的实际入口；计数直接约束重复工作，而非仅比较 DOM。
      const readHistory = vi.spyOn(historyItemStore, "read");
      const screen = await render(
        <StrictMode>
          <TooltipProvider>
            <div style={{ height: 600, width: 800 }}>{element}</div>
          </TooltipProvider>
        </StrictMode>,
      );
      await expect.element(screen.getByText("答复 history", { exact: true })).toBeVisible();
      expect(readHistory).toHaveBeenCalled();
      readHistory.mockClear();
      const base = {
        version: 2 as const,
        provider: engine,
        sessionId: "session",
        taskId: "task",
        timestamp,
      };

      store.getState().applyEvents([
        {
          ...base,
          sequence: 1,
          turnId: "new",
          type: "turn.started",
          payload: {
            turn: {
              id: "new",
              status: "running",
              startedAt: timestamp,
              completedAt: null,
              error: null,
              items: [{ id: "new-user", type: "message", role: "user", text: "新输入" }],
            },
          },
        },
      ]);
      await expect.element(screen.getByText("新输入", { exact: true })).toBeVisible();
      expect(readHistory).not.toHaveBeenCalled();

      store.getState().applyEvents([
        {
          ...base,
          sequence: 2,
          turnId: "new",
          itemId: "new-reply",
          type: "message.delta",
          payload: { delta: "新答复" },
        },
      ]);
      await expect.element(screen.getByText("新答复", { exact: true })).toBeVisible();
      expect(readHistory).not.toHaveBeenCalled();

      if (engine === "claude") {
        // 无用户输入的续跑扩展当前分组，历史组引用和正文聚合仍应保持稳定。
        store.getState().applyEvents([
          {
            ...base,
            sequence: 3,
            turnId: "continuation",
            type: "turn.started",
            payload: {
              turn: {
                id: "continuation",
                status: "running",
                startedAt: timestamp,
                completedAt: null,
                error: null,
                items: [
                  {
                    id: "continuation-reply",
                    type: "message",
                    role: "assistant",
                    text: "续跑答复",
                  },
                ],
              },
            },
          },
        ]);
      }
      await expect
        .element(screen.getByText(engine === "claude" ? "续跑答复" : "新答复", { exact: true }))
        .toBeVisible();
      expect(readHistory).not.toHaveBeenCalled();

      // 历史回合自身追加条目必须正常刷新，memo 不能阻断其 Store 订阅。
      store.getState().applyEvents([
        {
          ...base,
          sequence: 4,
          turnId: "history",
          itemId: "late-reply",
          type: "item.completed",
          payload: {
            item: {
              id: "late-reply",
              type: "message",
              role: "assistant",
              phase: "final_answer",
              text: "历史补充答复",
            },
          },
        },
      ]);
      await expect.element(screen.getByText("历史补充答复", { exact: true })).toBeVisible();
      expect(readHistory).toHaveBeenCalled();

      // 相同键的权威条目也会改变过程分类，不能仅依赖新增键驱动目标回合刷新。
      store.getState().applyEvents([
        {
          ...base,
          sequence: 5,
          turnId: "history",
          itemId: "history-reply",
          type: "item.completed",
          payload: {
            item: {
              id: "history-reply",
              type: "message",
              role: "assistant",
              phase: "commentary",
              text: "答复 history",
            },
          },
        },
      ]);
      await expect
        .element(screen.getByText("答复 history", { exact: true }))
        .not.toBeInTheDocument();
    },
  );
}
