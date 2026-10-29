import type { ConversationListProps } from "@codexly/ui/agent/conversation";
import { StrictMode } from "react";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import budgets from "../../../../../tests/performance-budgets.json";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { TaskStoreTimeline } from "./task-timeline-store.js";
import { createTaskStore as createWebTaskStore } from "../../../../../apps/web/src/features/conversation/runtime/task-store.js";
import { TaskStoreTimeline as WebTimeline } from "../../../../../apps/web/src/features/workbench/components/task-timeline-store.js";

const probe = vi.hoisted(() => ({ factories: [] as unknown[] }));
vi.mock("@codexly/ui/agent/conversation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@codexly/ui/agent/conversation")>();
  return {
    ...actual,
    ConversationList(props: ConversationListProps<string>) {
      // 只观察传给真实共享组件的工厂身份，不替换滚动、正文或订阅实现。
      probe.factories.push(props.renderItem);
      return <actual.ConversationList {...props} />;
    },
  };
});

const timestamp = "2026-10-29T00:00:00Z";
const capacity = budgets.activeConversation;
const actions = {
  onOpenFileDiff: () => undefined,
  onOpenSourceFile: () => undefined,
  onReviewFileChanges: () => undefined,
  onResolvePendingRequest: async () => undefined,
};

function response(taskId: string, engine: "codex" | "claude") {
  return {
    checkpoint: { sequence: 0, sessionId: "session" },
    snapshot: {
      id: taskId,
      projectId: "project",
      title: taskId,
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
      turns: Array.from({ length: capacity.turnsPerSplitPane }, (_, index) => ({
        id: `turn-${String(index)}`,
        status:
          index === capacity.turnsPerSplitPane - 1 ? ("running" as const) : ("completed" as const),
        startedAt: timestamp,
        completedAt: timestamp,
        error: null,
        items: [
          {
            id: `user-${String(index)}`,
            type: "message" as const,
            role: "user" as const,
            text: `问题 ${taskId} ${String(index)} ${"字".repeat(capacity.textCharactersPerMessage)}`,
          },
          {
            id: `reply-${String(index)}`,
            type: "message" as const,
            role: "assistant" as const,
            text: `答复 ${taskId} ${String(index)} ${"字".repeat(capacity.textCharactersPerMessage)}`,
          },
        ],
      })),
    },
  };
}

function trackSubscriptions(store: { subscribe: (listener: () => void) => () => void }) {
  const active = new Set<symbol>();
  const subscribe = store.subscribe;
  store.subscribe = (listener) => {
    const id = Symbol();
    active.add(id);
    const unsubscribe = subscribe(listener);
    return () => {
      active.delete(id);
      unsubscribe();
    };
  };
  return active;
}

for (const platform of [
  {
    name: "desktop",
    create(taskId: string, engine: "codex" | "claude") {
      const store = createTaskStore({ projectId: "project", taskId }, response(taskId, engine));
      return {
        store,
        render: (loading: boolean) => (
          <TaskStoreTimeline
            connected
            store={store}
            {...actions}
            hasOlderHistory
            isLoadingOlderHistory={loading}
          />
        ),
      };
    },
  },
  {
    name: "web",
    create(taskId: string, engine: "codex" | "claude") {
      const store = createWebTaskStore({ projectId: "project", taskId }, response(taskId, engine));
      return {
        store,
        render: (loading: boolean) => (
          <WebTimeline
            connected
            store={store}
            {...actions}
            hasOlderHistory
            isLoadingOlderHistory={loading}
          />
        ),
      };
    },
  },
]) {
  it.each(["codex", "claude"] as const)(
    `${platform.name}: %s 四分屏长会话隔离增量并在关闭后退订`,
    async (engine) => {
      const panes = Array.from({ length: capacity.splitPanes }, (_, index) => {
        const taskId = `pane-${String(index)}`;
        const pane = platform.create(taskId, engine);
        const { store } = pane;
        const subscriptions = [trackSubscriptions(store)];
        let historyReads = 0;
        const lastReplyId = `reply-${String(capacity.turnsPerSplitPane - 1)}`;
        for (const item of store.getState().itemStoresByKey.values()) {
          subscriptions.push(trackSubscriptions(item));
          if (index === 0 && item.peek().id === lastReplyId) continue;
          const observed: { read: () => unknown } = item;
          const read = observed.read;
          observed.read = () => {
            historyReads++;
            return read();
          };
        }
        return {
          taskId,
          store,
          render: pane.render,
          active: () => subscriptions.reduce((total, listeners) => total + listeners.size, 0),
          reads: () => historyReads,
          resetReads: () => {
            historyReads = 0;
          },
        };
      });
      const view = (count: number, loading = false) => (
        <StrictMode>
          <TooltipProvider>
            <div style={{ display: "flex", height: 600, width: 1_200 }}>
              {panes.slice(0, count).map(({ taskId, render }) => (
                <section key={taskId} style={{ width: 300 }}>
                  {render(loading)}
                </section>
              ))}
            </div>
          </TooltipProvider>
        </StrictMode>
      );
      const screen = await render(view(0));
      let mountedSubscriptions: number[] | undefined;
      for (let cycle = 0; cycle < capacity.reopenCycles; cycle++) {
        probe.factories = [];
        await screen.rerender(view(panes.length));
        await expect
          .poll(() => screen.container.querySelectorAll('[data-conversation-row="turn"]').length)
          .toBe(capacity.splitPanes * capacity.turnsPerSplitPane);
        const counts = panes.map((pane) => pane.active());
        expect(counts.every((count) => count > 0)).toBe(true);
        mountedSubscriptions ??= counts;
        expect(counts).toEqual(mountedSubscriptions);
        const factories = probe.factories.slice(-panes.length);
        probe.factories = [];
        panes.forEach((pane) => pane.resetReads());
        await screen.rerender(view(panes.length, true));
        expect(probe.factories.slice(-panes.length)).toEqual(factories);

        const first = panes[0]!;
        for (let batch = 1; batch <= capacity.streamBatches; batch++) {
          first.store.getState().applyEvents([
            {
              version: 2,
              provider: engine,
              sessionId: "session",
              taskId: first.taskId,
              turnId: `turn-${String(capacity.turnsPerSplitPane - 1)}`,
              itemId: `reply-${String(capacity.turnsPerSplitPane - 1)}`,
              sequence: cycle * capacity.streamBatches + batch,
              timestamp,
              type: "message.delta",
              payload: { delta: "x" },
            },
          ]);
        }
        await expect
          .element(
            screen.getByText(new RegExp(`x{${String((cycle + 1) * capacity.streamBatches)}}$`)),
          )
          .toBeInTheDocument();
        expect(panes.map((pane) => pane.reads())).toEqual(
          panes.map(() => capacity.maxUnrelatedHistoryReads),
        );
        // 单独关闭一个分屏只能释放该分屏的 UI 消费者，其他分屏订阅数量保持原值。
        await screen.rerender(view(panes.length - 1, true));
        expect(panes.at(-1)!.active()).toBe(capacity.maxUiSubscriptionsAfterClose);
        expect(panes.slice(0, -1).map((pane) => pane.active())).toEqual(counts.slice(0, -1));
        await screen.rerender(view(0));
        expect(screen.container.querySelectorAll('[data-conversation-row="turn"]')).toHaveLength(0);
        expect(panes.map((pane) => pane.active())).toEqual(
          panes.map(() => capacity.maxUiSubscriptionsAfterClose),
        );
      }
    },
    60_000,
  );
}
