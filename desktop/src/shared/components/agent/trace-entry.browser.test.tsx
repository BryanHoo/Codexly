import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { createTaskStore } from "../../../features/conversation/runtime/task-store.js";
import { TaskStoreTimeline } from "../../../features/workbench/components/task-timeline-store.js";
import { TooltipProvider } from "../core/tooltip.js";
import "../../styles/globals.css";

afterEach(() => {
  vi.restoreAllMocks();
});

it.each([false, true])("历史不重播且仅新步骤入场（减少动态效果：%s）", async (reduced) => {
  const originalMatchMedia = window.matchMedia.bind(window);
  vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    const result = originalMatchMedia(query);
    if (reduced && query === "(prefers-reduced-motion: reduce)")
      Object.defineProperty(result, "matches", { value: true });
    return result;
  });
  const animations = vi.spyOn(Element.prototype, "animate");
  const command = (id: string, label: string) => ({
    id,
    type: "command" as const,
    command: label,
    cwd: "/tmp",
    status: "running" as const,
    outputOmitted: { bytes: 0, lines: 0 },
  });
  const store = createTaskStore(
    { projectId: "project", taskId: "task" },
    {
      checkpoint: { sequence: 0, sessionId: "session" },
      snapshot: {
        id: "task",
        projectId: "project",
        title: "Motion",
        pinned: false,
        updatedAt: "2026-10-28T00:00:00Z",
        status: "running",
        pendingRequests: [],
        turnsNextCursor: null,
        contextUsage: null,
        goal: null,
        plan: null,
        settings: {
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          model: "model",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
        turns: [
          {
            id: "turn",
            status: "running",
            startedAt: "2026-10-28T00:00:00Z",
            completedAt: null,
            error: null,
            items: [command("old", "历史步骤")],
          },
        ],
      },
    },
  );
  const screen = await render(
    <StrictMode>
      <TooltipProvider>
        <div style={{ height: 500, width: 600 }}>
          <TaskStoreTimeline
            connected
            store={store}
            onOpenFileDiff={() => undefined}
            onOpenSourceFile={() => undefined}
            onReviewFileChanges={() => undefined}
            onResolvePendingRequest={async () => undefined}
          />
        </div>
      </TooltipProvider>
    </StrictMode>,
  );
  const entryCount = () =>
    animations.mock.calls.filter(
      ([, options]) => typeof options === "object" && options?.id === "agent-entry",
    ).length;
  expect(entryCount()).toBe(0);
  const base = {
    version: 2 as const,
    provider: "codex",
    sessionId: "session",
    taskId: "task",
    turnId: "turn",
    timestamp: "2026-10-28T00:00:01Z",
  };
  store
    .getState()
    .applyEvents([
      {
        ...base,
        sequence: 1,
        itemId: "new",
        type: "item.started",
        payload: { item: command("new", "新增步骤") },
      },
    ]);
  await expect.element(screen.getByRole("button", { name: /新增步骤/ })).toBeVisible();
  expect(entryCount()).toBe(reduced ? 0 : 1);
  store
    .getState()
    .applyEvents([
      {
        ...base,
        sequence: 2,
        itemId: "new",
        type: "command.output_delta",
        payload: { delta: "incremental output" },
      },
    ]);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(entryCount()).toBe(reduced ? 0 : 1);
  animations.mockRestore();
});
