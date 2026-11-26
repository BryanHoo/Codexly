import { acpSubagentItemPrefix } from "@codexly/protocol";
import { expect, it } from "vitest";
import { TaskSnapshotTimeline } from "./task-timeline.js";
import { completedTurn, renderToStaticMarkup, snapshot } from "./task-timeline.test-support.js";

it("ACP 主时间线仅展示根会话答复", () => {
  const child = acpSubagentItemPrefix("child");
  const markup = renderToStaticMarkup(
    <TaskSnapshotTimeline
      snapshot={{
        ...snapshot,
        runtime: "acp",
        turns: [
          {
            ...completedTurn,
            items: [
              { id: "root", type: "message", role: "assistant", text: "根会话最终答复" },
              {
                id: child,
                type: "acp_subagent",
                sessionId: "child",
                parentSessionId: "root",
                title: "独立审阅",
              },
              { id: child + "message", type: "message", role: "assistant", text: "子会话输出" },
            ],
          },
        ],
      }}
    />,
  );
  expect(markup).toContain("根会话最终答复");
  expect(markup).not.toContain("独立审阅");
  expect(markup).not.toContain("子会话输出");
});
