import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { AgentTaskSnapshot } from "@/protocol/index.js";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import { StoreTurnTimelineSection } from "./task-timeline-store.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";

it.each(["completed", "failed", "interrupted"] as const)("ends the pending timer for a %s turn without assistant output", (status) => {
  const snapshot: AgentTaskSnapshot = {
    id: "task", projectId: "project", title: "已完成任务", pinned: false,
    updatedAt: "2026-10-13T00:00:01Z", status: "idle",
    settings: { model: "model", reasoningEffort: "high", approvalPolicy: "on-request", approvalsReviewer: "user", sandboxMode: "workspace-write" },
    goal: null, plan: null, contextUsage: null, pendingRequests: [], turnsNextCursor: null,
    turns: [{ id: "turn", status, startedAt: "2026-10-13T00:00:00Z", completedAt: "2026-10-13T00:00:01Z", error: null,
      items: [{ id: "user", type: "message", role: "user", text: "任务输入" }] }],
  };
  const store = createTaskStore({ projectId: snapshot.projectId, taskId: snapshot.id }, { checkpoint: { sequence: 1, sessionId: "session" }, snapshot });
  const markup = renderToStaticMarkup(createElement(TooltipProvider, null, createElement(StoreTurnTimelineSection, {
    projectId: "project", taskId: "task", store, turnId: "turn", turnIndex: 0, pendingSubmission: true,
    onOpenFileDiff: () => {}, onOpenSourceFile: () => {}, onReviewFileChanges: () => {},
  })));
  expect(markup).toContain("任务输入");
  expect(markup).not.toContain('aria-label="AI 回复正在运行"');
  expect(markup).not.toContain("data-turn-processing-time");
});
