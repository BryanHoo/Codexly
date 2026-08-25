import type { ReactNode } from "react";
import { renderToStaticMarkup as renderReactToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import type { RuntimeTaskSnapshot } from "../../conversation/runtime/task-runtime.js";

// 集中维护拆分测试共享的样本、mock 与生命周期钩子。
export function renderToStaticMarkup(children: ReactNode) {
  return renderReactToStaticMarkup(<TooltipProvider>{children}</TooltipProvider>);
}

export const completedTurn: RuntimeTaskSnapshot["turns"][number] = {
  completedAt: "2026-07-24T00:01:00.000Z",
  error: null,
  id: "turn-1",
  items: [
    {
      content: "",
      id: "reasoning-1",
      summary: "**Preparing implementation**\n**Preparing final build and test verification**",
      type: "reasoning",
    },
  ],
  startedAt: "2026-07-24T00:00:00.000Z",
  status: "completed",
};

export const snapshot: RuntimeTaskSnapshot = {
  contextUsage: null,
  goal: null,
  plan: null,
  id: "task-1",
  pendingRequests: [],
  pinned: false,
  projectId: "codexly",
  settings: {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    sandboxMode: "workspace-write",
  },
  status: "idle",
  title: "Markdown 渲染",
  turns: [completedTurn],
  turnsNextCursor: null,
  updatedAt: "2026-07-24T00:01:00.000Z",
};

export const unpaginatedRuntime = {
  activeTurnId: undefined,
  hasOlderHistory: false,
  isLoadingOlderHistory: false,
  itemStructureRevision: 0,
  loadOlderHistory: () => Promise.resolve(),
  metadata: snapshot,
  olderHistoryError: null,
  readSnapshot: () => snapshot,
} as const;
