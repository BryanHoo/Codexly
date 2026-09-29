import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { TimelineItemContent } from "./task-timeline-items.js";
import "../../../shared/styles/globals.css";

test.each([
  "/Users/bryanhu/My Project/截图.png",
  "C:\\Users\\user\\My Project\\image.png",
  "./screenshots/image.webp",
])("点击查看图片活动中的路径打开图片预览：%s", async (path) => {
  const onOpenSourceFile = vi.fn();
  const screen = await render(
    <TimelineItemContent
      isLastTurnItem={false}
      item={{ id: "view-image", type: "activity", label: "查看图片", detail: path, status: "completed" }}
      onOpenFileDiff={() => {}}
      onOpenSourceFile={onOpenSourceFile}
      projectId="project"
      taskId="task"
      turnStatus="completed"
    />,
  );
  expect(onOpenSourceFile).not.toHaveBeenCalled();
  screen.getByText("查看图片", { exact: true }).element().closest("summary")!.click();
  const trigger = screen.getByRole("button", { name: path, exact: true });
  await expect.element(trigger).toBeVisible();
  await trigger.click();
  expect(onOpenSourceFile).toHaveBeenCalledExactlyOnceWith({ path, lineNumber: null });
});

test("普通活动详情不转换成图片打开按钮", async () => {
  const screen = await render(
    <TimelineItemContent
      isLastTurnItem={false}
      item={{ id: "activity", type: "activity", label: "等待", detail: "100ms", status: "completed" }}
      onOpenFileDiff={() => {}}
      onOpenSourceFile={() => {}}
      projectId="project"
      taskId="task"
      turnStatus="completed"
    />,
  );
  screen.getByText("等待", { exact: true }).element().closest("summary")!.click();
  await expect.element(screen.getByText("100ms", { exact: true })).toBeVisible();
  expect(screen.getByRole("button").query()).toBeNull();
});
