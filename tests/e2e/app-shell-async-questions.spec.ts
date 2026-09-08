import {
  expect,
  parseRequestRecord,
  taskSnapshot,
  taskSnapshotResponse,
  test,
} from "./fixtures/app-shell.js";
import { getComposerModelSelector } from "./app-shell-settings-navigation.test-support.js";

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`answers asynchronous questions while running at ${String(viewport.width)}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const submitted: Record<string, unknown>[] = [];
    const settingsUpdates: Record<string, unknown>[] = [];
    const question = {
      id: "async-1",
      type: "message",
      role: "assistant",
      phase: "commentary",
      text: "fallback question text",
      questions: [
        { title: "选择范围", options: ["当前文件", "整个项目"] },
        { title: "补充要求", options: null },
      ],
    };
    await page.route("**/v1/projects/codexly/tasks/task-1", (route) =>
      route.fulfill({
        json: {
          ...taskSnapshotResponse,
          snapshot: {
            ...taskSnapshot,
            status: "running",
            threadConfiguration: { model: "gpt-5.6-terra", reasoningEffort: "low" },
            turns: [
              { ...taskSnapshot.turns[0], status: "running", completedAt: null, items: [question] },
            ],
          },
        },
      }),
    );
    await page.route("**/v1/projects/codexly/tasks/task-1/settings", async (route) => {
      settingsUpdates.push(parseRequestRecord(route.request().postData()));
      await route.fallback();
    });
    await page.route("**/v1/projects/codexly/tasks/task-1/turns/turn-1/steer", async (route) => {
      submitted.push(parseRequestRecord(route.request().postData()));
      if (submitted.length === 1) {
        await route.fulfill({
          status: 502,
          json: { code: "PROVIDER_ERROR", message: "Retry answer", retryable: true },
        });
      } else {
        await route.fulfill({ json: { status: "accepted", taskId: "task-1", turnId: "turn-1" } });
      }
    });
    await page.goto("/p/codexly/t/task-1");
    const dock = page.getByRole("region", { name: "待回答问题" });
    await expect(dock).toBeVisible();
    const inputBounds = await page
      .getByRole("textbox", { name: "任务输入" })
      .locator("xpath=ancestor::form")
      .boundingBox();
    const dockBounds = await dock.boundingBox();
    if (inputBounds === null || dockBounds === null)
      throw new Error("Missing question panel bounds");
    expect(dockBounds.x).toBeCloseTo(inputBounds.x, 0);
    expect(dockBounds.width).toBeCloseTo(inputBounds.width, 0);
    expect(inputBounds.y - dockBounds.y - dockBounds.height).toBeGreaterThanOrEqual(0);
    expect(inputBounds.y - dockBounds.y - dockBounds.height).toBeLessThanOrEqual(12);
    await expect(dock.getByRole("button", { name: "关闭问题", exact: true })).toBeEnabled();
    await expect(getComposerModelSelector(page)).toHaveAccessibleName(
      "模型和思考量：GPT-5.6 Terra，低",
    );
    await expect(dock.getByRole("radio", { name: "当前文件", exact: true })).toBeChecked();
    expect(submitted).toHaveLength(0);
    await expect(dock.getByRole("button", { name: "发送回答" })).toBeDisabled();
    await dock.getByRole("radio", { name: "整个项目", exact: true }).check();
    await dock.getByRole("textbox", { name: "回答：补充要求" }).fill("保留测试");
    await page.getByRole("combobox", { name: "批准模式" }).selectOption("auto-review");
    await expect.poll(() => settingsUpdates.length).toBe(1);
    expect(settingsUpdates[0]).toMatchObject({
      approvalsReviewer: "auto_review",
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
    });
    await page.screenshot({
      path: testInfo.outputPath(`async-questions-${String(viewport.width)}.png`),
    });
    expect(await dock.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await dock.getByRole("button", { name: "发送回答" }).click();
    await expect(dock.getByRole("alert")).toContainText("回答未发送");
    await expect(dock.getByRole("textbox", { name: "回答：补充要求" })).toHaveValue("保留测试");
    await dock.getByRole("button", { name: "发送回答" }).click();
    await expect(dock).toHaveCount(0);
    expect(submitted).toHaveLength(2);
    expect(submitted[1]).toMatchObject({
      input: {
        type: "prompt",
        text: "选择范围\n整个项目\n\n补充要求\n保留测试",
        attachments: [],
        skills: [],
      },
    });
  });

  test(`dismisses unanswered asynchronous questions at ${String(viewport.width)}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const submitted: string[] = [];
    const questionIds = ["async-dismiss"];
    await page.route("**/v1/projects/codexly/tasks/task-1", (route) =>
      route.fulfill({
        json: {
          ...taskSnapshotResponse,
          snapshot: {
            ...taskSnapshot,
            status: "running",
            turns: [
              {
                ...taskSnapshot.turns[0],
                status: "running",
                completedAt: null,
                items: questionIds.map((id) => ({
                  id,
                  type: "message",
                  role: "assistant",
                  text: "补充要求",
                  questions: [{ title: "补充要求", options: null }],
                })),
              },
            ],
          },
        },
      }),
    );
    await page.route("**/v1/projects/codexly/tasks/task-1/turns/turn-1/steer", (route) => {
      submitted.push(route.request().postData() ?? "");
      return route.fulfill({ json: { status: "accepted", taskId: "task-1", turnId: "turn-1" } });
    });
    await page.goto("/p/codexly/t/task-1");
    const dock = page.getByRole("region", { name: "待回答问题" });
    await expect(dock).toBeVisible();
    await expect(dock.getByRole("button", { name: "发送回答" })).toBeDisabled();
    await dock.getByRole("button", { name: "关闭问题", exact: true }).click();
    await expect(dock).toHaveCount(0);
    expect(submitted).toHaveLength(0);
    await page.goto("/temporary");
    await page.goto("/p/codexly/t/task-1");
    await expect(page.getByRole("textbox", { name: "任务输入" })).toBeVisible();
    await expect(dock).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("textbox", { name: "任务输入" })).toBeVisible();
    await expect(dock).toHaveCount(0);
    expect(submitted).toHaveLength(0);
    questionIds.push("async-new");
    await page.reload();
    await expect(dock).toBeVisible();
    await expect(dock).toContainText("待回答 · 1 组");
    await dock.getByRole("button", { name: "关闭问题", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("textbox", { name: "任务输入" })).toBeVisible();
    await expect(dock).toHaveCount(0);
    expect(submitted).toHaveLength(0);
  });
}
