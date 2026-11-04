import { expect, test } from "./fixtures/app-shell.js";

for (const width of [390, 1280]) {
  test(`adds files dropped over the conversation at ${String(width)}px @cross-browser`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/p/codexly/t/task-1");
    const prompt = page.getByRole("textbox", { name: "任务输入" });
    await expect(prompt).toBeVisible();
    const canceled = await prompt.evaluate((input) => {
      const pane = input.closest("[data-split-pane]");
      if (pane === null) throw new Error("Missing conversation pane");
      const transfer = new DataTransfer();
      transfer.items.add(new File(["note"], "dropped.txt", { type: "text/plain" }));
      transfer.items.add(
        new File([new Uint8Array([137, 80, 78, 71])], "dropped.png", { type: "image/png" }),
      );
      // 向消息所在窗格派发真实 DOM 拖放事件，覆盖表单以外的中栏区域。
      const over = new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      });
      pane.dispatchEvent(over);
      const drop = new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      });
      pane.dispatchEvent(drop);
      return over.defaultPrevented && drop.defaultPrevented;
    });
    expect(canceled).toBe(true);
    await expect(page.getByText("dropped.txt", { exact: true })).toBeVisible();
    await expect(page.getByText("dropped.png", { exact: true })).toBeVisible();
    await expect(prompt).toHaveAttribute("data-serialized-value", "");
  });
}
