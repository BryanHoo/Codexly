import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentTaskSnapshot, AgentTurn } from "@/protocol/index.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { describe, expect, it, vi } from "vitest";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import { TaskStoreTimeline } from "./task-timeline-store.js";
const snapshot: AgentTaskSnapshot = {
  id: "task", projectId: "project", engine: "claude", title: "Claude 续跑", pinned: false,
  updatedAt: "2026-10-19T00:00:28Z", status: "idle", pendingRequests: [], turnsNextCursor: null,
  contextUsage: null, goal: null, plan: null,
  settings: { model: "sonnet", reasoningEffort: "high", approvalPolicy: "on-request", approvalsReviewer: "user", sandboxMode: "workspace-write" },
  turns: [],
};

// 桌面虚拟列表在服务端没有视口；显式渲染其行以验证实际回复组件。
vi.mock("../../../shared/components/agent/conversation.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../shared/components/agent/conversation.js")>(),
  ConversationList: ({ items, renderItem }: { items: string[]; renderItem: (id: string, index: number) => import("react").ReactNode }) =>
    createElement("div", null, items.map(renderItem)),
}));

// 回归聚焦回复分组，过程分页仍由原生回合身份加载，不在服务端渲染中访问客户端。
vi.mock("./task-timeline-lazy-process.js", () => ({
  TurnProcessHistory: ({ turnId }: { turnId: string }) => createElement("div", { "data-process-turn": turnId }),
  EmptyTurnProcessHistory: () => null,
}));

const turns: AgentTurn[] = [0, 1, 2].map((index) => ({
  id: `turn-${index}`,
  startedAt: `2026-10-19T00:00:${String(index * 10).padStart(2, "0")}Z`,
  completedAt: `2026-10-19T00:00:${String(index * 10 + 8).padStart(2, "0")}Z`,
  status: "completed",
  error: null,
  processCursor: `cursor-${index}`,
  items: [
    ...(index === 0
      ? [{ id: "input", type: "message" as const, role: "user" as const, text: "用户问题" }]
      : []),
    {
      id: `answer-${index}`,
      type: "message",
      role: "assistant",
      phase: "final_answer",
      text: `阶段答复${index}`,
    },
  ],
}));

function render(engine: "claude" | "codex", sourceTurns = turns) {
  const store = createTaskStore(
    { projectId: snapshot.projectId, taskId: snapshot.id },
    {
      checkpoint: { sequence: 0, sessionId: "test" },
      snapshot: { ...snapshot, engine, turns: sourceTurns },
    },
  );
  return renderToStaticMarkup(createElement(TooltipProvider, null, createElement(TaskStoreTimeline, {
    connected: true, store, onOpenFileDiff: () => undefined, onOpenSourceFile: () => undefined,
    onReviewFileChanges: () => undefined, onResolvePendingRequest: () => Promise.resolve(),
  })));
}

describe("Claude automatic continuation replies", () => {
  it("shows one total duration and keeps every answer and native process cursor", () => {
    const markup = render("claude");
    expect(markup.match(/data-turn-processing-time/g)).toHaveLength(1);
    expect(markup).toContain('dateTime="PT28S"');
    for (let index = 0; index < 3; index++) {
      expect(markup).toContain(`阶段答复${index}`);
      expect(markup).toContain(`data-process-turn="turn-${index}"`);
    }
  });

  it("starts a separate reply for another user submission", () => {
    const next: AgentTurn = {
      ...turns[0]!,
      id: "next",
      items: [
        { id: "next-input", type: "message", role: "user", text: "第二个问题" },
        { id: "next-answer", type: "message", role: "assistant", text: "新的答复" },
      ],
    };
    expect(render("claude", [...turns, next]).match(/data-turn-processing-time/g)).toHaveLength(2);
  });

  it("keeps the reply running while an automatic continuation is running", () => {
    const markup = render("claude", [
      ...turns.slice(0, 2),
      { ...turns[2]!, status: "running", completedAt: null },
    ]);
    expect(markup.match(/data-turn-processing-time/g)).toHaveLength(1);
    expect(markup).toContain('data-status="running"');
    expect(markup).toContain("阶段答复0");
    expect(markup).toContain('aria-label="AI 回复正在运行"');
  });

  it("preserves Codex turn presentation", () => {
    expect(render("codex").match(/data-turn-processing-time/g)).toHaveLength(3);
  });
});
