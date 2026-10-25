import { readFile } from "node:fs/promises";
import { expect, test, taskSnapshotResponse } from "./fixtures/app-shell.js";

for (const mobile of [false, true]) {
  test(`导出完整 JSON 对话 ${mobile ? "窄屏" : "宽屏"} @cross-browser`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const cursors: (string | null)[] = [];
    await page.route("**/v1/projects/codexly/tasks/task-1?*", (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("summary") !== "false") return route.fallback();
      const cursor = url.searchParams.get("cursor");
      cursors.push(cursor);
      return route.fulfill({
        json: {
          ...taskSnapshotResponse,
          snapshot: {
            ...taskSnapshotResponse.snapshot,
            turns: [
              {
                id: cursor === null ? "new" : "old",
                status: "completed",
                startedAt: null,
                completedAt: null,
                error: null,
                items: [
                  {
                    id: cursor === null ? "answer" : "question",
                    type: "message",
                    role: cursor === null ? "assistant" : "user",
                    text: cursor === null ? "你好 🐈\n```ts\nconst n = 1;\n```" : "完整历史问题",
                  },
                ],
              },
            ],
            turnsNextCursor: cursor === null ? "older" : null,
          },
        },
      });
    });
    await page.goto("/p/codexly");
    if (mobile) await page.getByRole("button", { name: "展开项目侧栏" }).click();
    await page
      .getByRole("link", { name: /构建 macOS 工作台/u })
      .first()
      .hover();
    await page.getByRole("button", { name: "打开 构建 macOS 工作台 的操作菜单" }).first().click();
    const waiting = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "导出对话记录", exact: true }).click();
    const download = await waiting;
    expect(download.suggestedFilename()).toMatch(/^codexly-conversation-.*\.json$/u);
    const archive: unknown = JSON.parse(await readFile(await download.path(), "utf8"));
    expect(archive).toMatchObject({
      format: "codexly-conversation",
      version: 1,
      task: { id: "task-1", projectId: "codexly" },
      turns: [{ id: "old" }, { id: "new", items: [{ text: "你好 🐈\n```ts\nconst n = 1;\n```" }] }],
    });
    expect(cursors).toEqual([null, "older"]);
  });
}

test("导出中禁止重复执行，失败后允许重试", async ({ page }) => {
  const { promise, resolve } = Promise.withResolvers<undefined>();
  let calls = 0;
  await page.route("**/v1/projects/codexly/tasks/task-1?summary=false", async (route) => {
    calls++;
    if (calls === 1) {
      await promise;
      await route.fulfill({
        status: 503,
        json: { code: "INTERNAL_ERROR", message: "offline", retryable: true },
      });
    } else await route.fulfill({ json: taskSnapshotResponse });
  });
  await page.goto("/p/codexly");
  await page
    .getByRole("link", { name: /构建 macOS 工作台/u })
    .first()
    .hover();
  await page.getByRole("button", { name: "打开 构建 macOS 工作台 的操作菜单" }).first().click();
  await page.getByRole("menuitem", { name: "导出对话记录", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "正在导出…" })).toBeDisabled();
  await expect.poll(() => calls).toBe(1);
  resolve(undefined);
  await expect(page.getByText("对话记录导出失败，请重试。", { exact: true })).toBeVisible();
  const waiting = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "导出对话记录", exact: true }).click();
  await waiting;
  expect(calls).toBe(2);
});
