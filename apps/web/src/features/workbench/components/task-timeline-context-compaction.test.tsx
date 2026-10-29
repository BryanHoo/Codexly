import type { AgentItem } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";
import { TimelineItemContent } from "./task-timeline-items.js";
import { resolveCompletedTurnProcessItemIds } from "./task-timeline-process.js";
import { TaskSnapshotTimeline } from "./task-timeline.js";
import { completedTurn, renderToStaticMarkup, snapshot } from "./task-timeline.test-support.js";

const answer = {
  id: "answer",
  type: "message",
  role: "assistant",
  phase: "final_answer",
  text: "处理完成。",
} as const;

describe("completed context compaction", () => {
  it.each([undefined, "pending", "running", "completed"] as const)(
    "folds compaction with item status %s even without its completion event",
    (status) => {
      const activity: AgentItem = {
        id: "compaction",
        type: "activity",
        label: "上下文压缩",
        transient: true,
        ...(status === undefined ? {} : { status }),
      };
      // 历史加载可能缺少最终阶段，压缩事件也可能晚于答复到达；均应归入过程。
      for (const items of [[activity, answer], [answer, activity], [activity]]) {
        expect(resolveCompletedTurnProcessItemIds(items, "completed")).toEqual([activity.id]);
        expect(resolveCompletedTurnProcessItemIds(items, "running")).toEqual([]);
        const markup = renderToStaticMarkup(
          <TaskSnapshotTimeline snapshot={{ ...snapshot, turns: [{ ...completedTurn, items }] }} />,
        );
        expect(markup).not.toContain("上下文压缩");
        expect(markup).toContain('aria-label="展开执行过程"');
      }
    },
  );

  it.each([
    undefined,
    "pending",
    "running",
    "completed",
    "failed",
    "declined",
    "interrupted",
  ] as const)(
    "restores compaction with status %s as a finished process entry when expanded",
    (status) => {
      const markup = renderToStaticMarkup(
        <TimelineItemContent
          isLastTurnItem={false}
          item={{
            id: "compaction",
            type: "activity",
            label: "上下文压缩",
            transient: true,
            ...(status === undefined ? {} : { status }),
          }}
          onOpenFileDiff={vi.fn()}
          onOpenSourceFile={vi.fn()}
          projectId="project-1"
          taskId="task-1"
          turnStatus="completed"
        />,
      );
      expect(markup).toContain("上下文压缩");
      expect(markup).not.toContain("animate-spin");
      const expectedStatus =
        status === "failed" || status === "declined" || status === "interrupted"
          ? "error"
          : "completed";
      expect(markup).toContain(`data-status="${expectedStatus}"`);
    },
  );
});
