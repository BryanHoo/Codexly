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
  await expect.element(screen.getByText("查看图片", { exact: true })).toBeInTheDocument();
  // 使用真实样式测量中心线，防止状态图标被行内基线抬高。
  const title = screen.getByText("查看图片", { exact: true }).element();
  const icon = title.closest("[data-slot=trace-line]")!.querySelector("[data-slot=trace-status-icon]")!;
  const titleBox = title.getBoundingClientRect();
  const iconBox = icon.getBoundingClientRect();
  expect(Math.abs((iconBox.top + iconBox.height / 2) - (titleBox.top + titleBox.height / 2))).toBeLessThanOrEqual(1);
  screen.getByText("查看图片", { exact: true }).element().closest("button")!.click();
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
  await expect.element(screen.getByText("等待", { exact: true })).toBeInTheDocument();
  screen.getByText("等待", { exact: true }).element().closest("button")!.click();
  await expect.element(screen.getByText("100ms", { exact: true })).toBeVisible();
  expect(screen.getByRole("button", { name: "100ms", exact: true }).query()).toBeNull();
});
