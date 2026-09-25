import type { AgentItem } from "@/protocol/index.js";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { TimelineItemContent } from "./task-timeline-items.js";

it("正文已有 $skill 时不再重复展示元数据标记", async () => {
  const item = {
    id: "user-1", role: "user", type: "message", text: "请用 $review 检查",
    skills: [{ name: "review" }],
  } satisfies AgentItem;
  const screen = await render(
    <TimelineItemContent
      isLastTurnItem={false}
      item={item}
      onOpenFileDiff={() => undefined}
      onOpenSourceFile={() => undefined}
      projectId="project"
      taskId="task"
      turnStatus="completed"
    />,
  );
  await expect.element(screen.getByText(/请用.*检查/u)).toBeVisible();
  expect(screen.container.textContent?.match(/\$review/gu)).toHaveLength(1);
});
