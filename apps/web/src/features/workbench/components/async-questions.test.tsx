import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { TimelineItemContent } from "./task-timeline-items.js";
import { questionItem } from "./async-question-test-fixtures.js";

test("renders structured questions in history without duplicate fallback text", () => {
  const markup = renderToStaticMarkup(
    <TimelineItemContent
      isLastTurnItem={false}
      onOpenFileDiff={() => undefined}
      onOpenSourceFile={() => undefined}
      item={{ ...questionItem("scope", "选择范围"), text: "fallback text" }}
      projectId="project-a"
      taskId="task-a"
      turnStatus="running"
    />,
  );
  expect(markup).toContain("当前文件");
  expect(markup).not.toContain("fallback text");
  expect(markup).not.toContain("<textarea");
});
