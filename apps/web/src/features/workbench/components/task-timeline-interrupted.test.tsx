import type { AgentItem } from "@codexly/protocol";
import { describe, expect, it } from "vitest";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import { resolveCompletedTurnProcessItemIds } from "./task-timeline-process.js";
import { TaskStoreTimeline } from "./task-timeline-store.js";
import { TaskSnapshotTimeline } from "./task-timeline.js";
import { completedTurn, renderToStaticMarkup, snapshot } from "./task-timeline.test-support.js";

const items: AgentItem[] = [
  { id: "input", type: "message", role: "user", text: "Initial request" },
  {
    id: "partial",
    type: "message",
    role: "assistant",
    phase: "final_answer",
    text: "Partial output",
  },
  { id: "changes", type: "file_change", status: "completed", changes: [] },
];

describe("interrupted turn collapse", () => {
  it.each(["interrupted", "failed"] as const)(
    "defers %s output collapse until the next submission",
    (status) => {
      expect(resolveCompletedTurnProcessItemIds(items, status, false)).toEqual([]);
      expect(resolveCompletedTurnProcessItemIds(items, status, true)).toEqual([
        "partial",
        "changes",
      ]);
      const interrupted = { ...completedTurn, status, items };
      const currentSnapshot = { ...snapshot, turns: [interrupted] };
      expect(renderToStaticMarkup(<TaskSnapshotTimeline snapshot={currentSnapshot} />)).toContain(
        "Partial output",
      );
      const historical = renderToStaticMarkup(
        <TaskSnapshotTimeline
          snapshot={{
            ...currentSnapshot,
            turns: [
              interrupted,
              {
                ...completedTurn,
                id: "next-turn",
                status: "running",
                items: [{ id: "next-input", type: "message", role: "user", text: "Next request" }],
              },
            ],
          }}
        />,
      );
      expect(historical).not.toContain("Partial output");
      expect(historical).toContain("Initial request");
      expect(historical).toContain('aria-label="展开执行过程"');

      const store = createTaskStore(
        { projectId: snapshot.projectId, taskId: snapshot.id },
        {
          checkpoint: { sequence: 0, sessionId: "test" },
          snapshot: currentSnapshot,
        },
      );
      const pending = renderToStaticMarkup(
        <TaskStoreTimeline
          connected
          store={store}
          submissionStartedAt="2026-07-24T00:02:00.000Z"
          onOpenFileDiff={() => undefined}
          onOpenSourceFile={() => undefined}
          onReviewFileChanges={() => undefined}
          onResolvePendingRequest={() => Promise.resolve()}
        />,
      );
      expect(pending).not.toContain("Partial output");
      expect(pending).toContain('aria-label="展开执行过程"');
    },
  );
});
