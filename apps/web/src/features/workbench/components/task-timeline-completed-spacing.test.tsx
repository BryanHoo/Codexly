import { expect, it } from "vitest";
import { TaskSnapshotTimeline } from "./task-timeline.js";
import { completedTurn, renderToStaticMarkup, snapshot } from "./task-timeline.test-support.js";

it("omits completed file change wrappers while retaining the reply and file summary", () => {
  const markup = renderToStaticMarkup(
    <TaskSnapshotTimeline
      snapshot={{
        ...snapshot,
        turns: [
          {
            ...completedTurn,
            items: [
              ...Array.from({ length: 18 }, (_, index) => ({
                id: `change-${String(index)}`,
                type: "file_change" as const,
                status: "completed" as const,
                changes: [
                  { path: `src/file-${String(index)}.ts`, kind: "update" as const, diff: "+line" },
                ],
              })),
              {
                id: "reply",
                type: "message",
                role: "assistant",
                phase: "final_answer",
                text: "已完成修复",
              },
            ],
          },
        ],
      }}
    />,
  );
  expect(markup).toContain("已完成修复");
  expect(markup).not.toMatch(/data-agent-entry="[^"]*change-/u);
  expect(markup.match(/data-agent-entry=/gu)).toHaveLength(1);
  expect(markup).toContain("file-0.ts");
});
