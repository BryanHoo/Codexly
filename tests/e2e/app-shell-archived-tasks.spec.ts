import { expect, test } from "./fixtures/app-shell.js";

test("manages searchable paginated archived tasks from the project menu", async ({ page }) => {
  const archivedTasks = Array.from({ length: 21 }, (_, index) => ({
    id: `archived-${String(index + 1)}`,
    pinned: false,
    projectId: "codexly",
    title: index === 20 ? "搜索命中的归档任务" : `归档任务 ${String(index + 1)}`,
    updatedAt: "2026-08-23T00:00:00.000Z",
  }));
  let restoredTaskId: string | null = null;
  const deletedTaskIds = new Set<string>();
  let bulkDeleteRequests = 0;
  let individualDeleteRequests = 0;

  await page.route("**/v1/projects/codexly/tasks?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("archived") !== "true") {
      await route.fallback();
      return;
    }
    const searchTerm = url.searchParams.get("searchTerm");
    const cursor = url.searchParams.get("cursor");
    const available = archivedTasks.filter(
      (task) =>
        task.id !== restoredTaskId &&
        !deletedTaskIds.has(task.id) &&
        (searchTerm === null || task.title.includes(searchTerm)),
    );
    const start = cursor === "page-2" ? 20 : 0;
    await route.fulfill({
      contentType: "application/json",
      json: {
        data: available.slice(start, start + 20),
        nextCursor: start === 0 && available.length > 20 ? "page-2" : null,
      },
    });
  });
  await page.route("**/v1/projects/codexly/tasks/*/unarchive", async (route) => {
    restoredTaskId = /tasks\/([^/]+)\/unarchive$/u.exec(route.request().url())?.[1] ?? null;
    const task = archivedTasks.find((item) => item.id === restoredTaskId);
    await route.fulfill({
      contentType: "application/json",
      json: { task, tasks: { data: task === undefined ? [] : [task], nextCursor: null } },
    });
  });
  await page.route("**/v1/projects/codexly/tasks/archived-*", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.fallback();
      return;
    }
    const deletedTaskId = /tasks\/([^/?]+)$/u.exec(route.request().url())?.[1] ?? null;
    individualDeleteRequests++;
    if (deletedTaskId !== null) deletedTaskIds.add(deletedTaskId);
    await route.fulfill({
      contentType: "application/json",
      json: { status: "deleted", taskId: deletedTaskId, tasks: { data: [], nextCursor: null } },
    });
  });

  await page.route("**/v1/projects/codexly/tasks/archived", async (route) => {
    bulkDeleteRequests++;
    const remaining = archivedTasks.filter(
      (task) => task.id !== restoredTaskId && !deletedTaskIds.has(task.id),
    );
    for (const task of remaining) deletedTaskIds.add(task.id);
    await route.fulfill({ json: { deletedCount: remaining.length, failedCount: 0 } });
  });

  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("button", { name: "打开 Codexly 的项目操作菜单" }).click();
  await page.getByRole("menuitem", { name: "已归档" }).click();

  const dialog = page.getByRole("dialog", { name: "Codexly 的已归档任务" });
  await expect(dialog.getByText("归档任务 1", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "下一页" })).toBeEnabled();
  await dialog.getByRole("button", { name: "下一页" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByText("第 2 页", { exact: true })).toBeVisible();
  await expect(dialog.getByText("搜索命中的归档任务", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "上一页" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByText("第 1 页", { exact: true })).toBeVisible();
  await dialog.getByRole("textbox", { name: "搜索已归档任务" }).fill("搜索命中");
  await expect(dialog.getByText("搜索命中的归档任务", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "恢复任务 搜索命中的归档任务" }).click();
  await expect.poll(() => restoredTaskId).toBe("archived-21");
  await dialog.getByRole("textbox", { name: "搜索已归档任务" }).fill("归档任务 1");
  await dialog.getByRole("button", { name: "永久删除任务 归档任务 1", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "永久删除任务" });
  await confirmation.getByRole("button", { name: "永久删除" }).click();
  await expect.poll(() => deletedTaskIds.has("archived-1")).toBe(true);

  await dialog.getByRole("button", { name: "全部删除" }).click();
  const deleteAllConfirmation = page.getByRole("dialog", {
    name: "永久删除全部已归档任务",
  });
  await expect(deleteAllConfirmation).toContainText("Codexly");
  await deleteAllConfirmation.getByRole("button", { name: "全部永久删除" }).click();
  await expect.poll(() => deletedTaskIds.size).toBe(20);
  expect(bulkDeleteRequests).toBe(1);
  expect(individualDeleteRequests).toBe(1);
  await expect(dialog.getByText("没有已归档任务", { exact: true })).toBeVisible();
});
