import type { AgentTurn } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import { TaskStoreTimeline } from "./task-timeline-store.js";
import { renderToStaticMarkup, snapshot } from "./task-timeline.test-support.js";

// 回归聚焦回复分组，过程分页仍由原生回合身份加载，不在服务端渲染中访问客户端。
vi.mock("./task-timeline-lazy-process.js", () => ({
  TurnProcessHistory: ({ turnId }: { turnId: string }) => <div data-process-turn={turnId} />,
  EmptyTurnProcessHistory: () => null,
}));

const turns: AgentTurn[] = [0, 1, 2].map((index) => ({
  id: `turn-${String(index)}`,
  startedAt: `2026-10-19T00:00:${String(index * 10).padStart(2, "0")}Z`,
  completedAt: `2026-10-19T00:00:${String(index * 10 + 8).padStart(2, "0")}Z`,
  status: "completed",
  error: null,
  processCursor: `cursor-${String(index)}`,
  items: [
    ...(index === 0
      ? [{ id: "input", type: "message" as const, role: "user" as const, text: "用户问题" }]
      : []),
    {
      id: `answer-${String(index)}`,
      type: "message",
      role: "assistant",
      phase: "final_answer",
      text: `阶段答复${String(index)}`,
    },
  ],
}));

const firstTurn = turns[0];
const thirdTurn = turns[2];
if (firstTurn === undefined || thirdTurn === undefined)
  throw new Error("Missing regression fixture");

function render(engine: "claude" | "codex", sourceTurns = turns) {
  const store = createTaskStore(
    { projectId: snapshot.projectId, taskId: snapshot.id },
    {
      checkpoint: { sequence: 0, sessionId: "test" },
      snapshot: { ...snapshot, engine, turns: sourceTurns },
    },
  );
  return renderToStaticMarkup(
    <TaskStoreTimeline
      connected
      store={store}
      onOpenFileDiff={() => undefined}
      onOpenSourceFile={() => undefined}
      onReviewFileChanges={() => undefined}
      onResolvePendingRequest={() => Promise.resolve()}
    />,
  );
}

describe("Claude automatic continuation replies", () => {
  it("shows one total duration and keeps every answer and native process cursor", () => {
    const markup = render("claude");
    expect(markup.match(/data-turn-processing-time/g)).toHaveLength(1);
    expect(markup).toContain('dateTime="PT28S"');
    for (let index = 0; index < 3; index++) {
      expect(markup).toContain(`阶段答复${String(index)}`);
      expect(markup).toContain(`data-process-turn="turn-${String(index)}"`);
    }
  });

  it("starts a separate reply for another user submission", () => {
    const next: AgentTurn = {
      ...firstTurn,
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
      { ...thirdTurn, status: "running", completedAt: null },
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
