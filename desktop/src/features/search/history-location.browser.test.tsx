import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentTaskSnapshotResponse } from "@/protocol/index.js";
import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { i18n } from "../../i18n/i18n.js";
import { TooltipProvider } from "../../shared/components/core/tooltip.js";
import { HistoryTaskTimeline } from "./history-task-timeline.js";
import { createTaskItemKey } from "../conversation/runtime/task-store.js";
import "../../shared/styles/globals.css";
import "../../shared/styles/workbench.css";
const { readTask } = vi.hoisted(() => ({ readTask: vi.fn() }));
vi.mock("../projects/project-context.js", () => ({
  useProjectData: () => ({ client: { readTask } }),
}));

function historyPage(): AgentTaskSnapshotResponse {
  return {
    checkpoint: { sequence: 0, sessionId: "s" },
    snapshot: {
      id: "task",
      projectId: "project",
      title: "Task",
      pinned: false,
      contextUsage: null,
      goal: null,
      plan: null,
      pendingRequests: [],
      status: "idle",
      updatedAt: "2026-09-15T00:00:00Z",
      turnsNextCursor: "older",
      settings: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
      turns: Array.from({ length: 20 }, (_, index) => ({
        id: `turn-${index}`,
        status: "completed" as const,
        error: null,
        startedAt: "2026-09-15T00:00:00Z",
        completedAt: "2026-09-15T00:01:00Z",
        items: [
          {
            id: `user-${index}`,
            type: "message" as const,
            role: "user" as const,
            text: `第 ${index} 个问题`,
          },
          {
            id: `assistant-${index}`,
            type: "message" as const,
            role: "assistant" as const,
            text: `第 ${index} 个答复，中文关键词需要高亮。\n\n${"用于验证历史滚动位置。".repeat(15)}`,
          },
        ],
      })),
    },
  };
}

describe("history search location", () => {
  it("reads only the cursor page and scrolls to a highlighted assistant message", async () => {
    await i18n.changeLanguage("zh-CN");
    readTask.mockResolvedValue(historyPage());
    const location = {
      projectId: "project",
      taskId: "task",
      turnId: "turn-2",
      itemId: "assistant-2",
      turnCursor: "inclusive-turn-2",
      query: "中文关键词",
      snippet: "中文关键词需要高亮",
      snippetMatchRange: { start: 0, end: 5 },
    };
    const screen = await render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TooltipProvider>
          <div
            style={{ height: 500, display: "flex", flexDirection: "column" }}
          >
            <HistoryTaskTimeline location={location} />
          </div>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    await expect
      .element(screen.getByRole("button", { name: "返回最新消息" }))
      .toBeVisible();
    await vi.waitFor(() => {
      const anchor = document.querySelector<HTMLElement>(
        '[data-search-match="true"]',
      );
      expect(anchor?.dataset["conversationAnchor"]).toBe(
        createTaskItemKey("turn-2", "assistant-2"),
      );
      const viewport = screen
        .getByRole("log")
        .element()
        .getBoundingClientRect();
      const bounds = anchor!.getBoundingClientRect();
      expect(bounds.top).toBeGreaterThanOrEqual(viewport.top - 10);
      expect(bounds.top).toBeLessThan(viewport.bottom);
    });
    const marked = document.querySelector<HTMLElement>('[data-search-match="true"]')!;
    expect(getComputedStyle(marked).outlineStyle).toBe("none");
    expect(getComputedStyle(marked).boxShadow).not.toBe("none");
    await page.screenshot({ path: "../../../test-results/search-history-light.png" });
    document.documentElement.dataset["theme"] = "dark";
    try {
      await page.screenshot({ path: "../../../test-results/search-history-dark.png" });
    } finally {
      delete document.documentElement.dataset["theme"];
    }
    expect(readTask).toHaveBeenCalledTimes(1);
    expect(readTask).toHaveBeenCalledWith("project", "task", {
      cursor: "inclusive-turn-2",
      signal: expect.any(AbortSignal),
    });
  });

  it("resolves the visible message again when snapshot projection changes its item id", async () => {
    await i18n.changeLanguage("zh-CN");
    readTask.mockResolvedValue(historyPage());
    const location = {
      projectId: "project",
      taskId: "task",
      turnId: "turn-2",
      itemId: "indexed-assistant-2",
      turnCursor: "inclusive-turn-2",
      query: "中文关键词",
      snippet: "中文关键词需要高亮",
      snippetMatchRange: { start: 0, end: 5 },
    };
    const screen = await render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TooltipProvider>
          <div
            style={{ height: 500, display: "flex", flexDirection: "column" }}
          >
            <HistoryTaskTimeline location={location} />
          </div>
        </TooltipProvider>
      </QueryClientProvider>,
    );

    await vi.waitFor(() => {
      expect(screen.getByRole("alert").query()).toBeNull();
      expect(
        document.querySelector<HTMLElement>('[data-search-match="true"]')
          ?.dataset["conversationAnchor"],
      ).toBe(createTaskItemKey("turn-2", "assistant-2"));
    });
  });
});
