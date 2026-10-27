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
  const projectMenu = page.getByRole("button", { name: "打开 Codexly 的项目操作菜单" });
  await expect(projectMenu).toBeVisible();
  const now = new Date();
  await page.clock.install({ time: now });
  await projectMenu.click();
  await page.getByRole("menuitem", { name: "已归档" }).click();

  const dialog = page.getByRole("dialog", { name: "Codexly 的已归档任务" });
  await expect(dialog.getByText("归档任务 1", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "下一页" })).toBeEnabled();
  await dialog.getByRole("button", { name: "下一页" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByText("第 2 页", { exact: true })).toBeVisible();
  // 初次挂载的搜索防抖结束后，不能把用户刚翻到的第二页重置。
  await page.clock.runFor(300);
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
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

for (const width of [1280, 375]) {
  test(`deletes archived tasks within a fixed range at width ${String(width)} @cross-browser`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.clock.setFixedTime(new Date("2026-10-24T12:00:00Z"));
    const tasks = [
      { id: "old", title: "很早的归档", updatedAt: "2026-01-01T00:00:00Z" },
      { id: "boundary", title: "边界日期的归档", updatedAt: "2026-07-24T00:00:00Z" },
      { id: "recent", title: "近期归档", updatedAt: "2026-10-20T00:00:00Z" },
    ].map((task) => ({ ...task, pinned: false, projectId: "codexly" }));
    const deleted = new Set<string>();
    const cutoffs: string[] = [];
    await page.route("**/v1/projects/codexly/tasks?*", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("archived") !== "true") return route.fallback();
      const search = url.searchParams.get("searchTerm") ?? "";
      await route.fulfill({
        json: {
          data: tasks.filter((task) => !deleted.has(task.id) && task.title.includes(search)),
          nextCursor: null,
        },
      });
    });
    await page.route("**/v1/projects/codexly/tasks/archived", async (route) => {
      const { updatedBefore } = route.request().postDataJSON() as { updatedBefore: string };
      cutoffs.push(updatedBefore);
      const matching = tasks.filter(
        (task) => !deleted.has(task.id) && Date.parse(task.updatedAt) < Date.parse(updatedBefore),
      );
      for (const task of matching) deleted.add(task.id);
      await route.fulfill({ json: { deletedCount: matching.length, failedCount: 0 } });
    });
    await page.goto("/p/codexly/t/task-1");
    if (width < 640) await page.getByRole("button", { name: "展开项目侧栏" }).click();
    await page.getByRole("button", { name: "打开 Codexly 的项目操作菜单" }).click();
    await page.getByRole("menuitem", { name: "已归档" }).click();
    const dialog = page.getByRole("dialog", { name: "Codexly 的已归档任务" });
    const range = dialog.getByRole("combobox", { name: "选择归档删除范围" });
    await range.click();
    await expect(page.getByRole("option")).toHaveCount(5);
    await expect(page.getByRole("option", { name: "自定义日期", exact: true })).toHaveCount(0);
    await page.getByRole("option", { name: "半年前", exact: true }).click();
    await dialog.getByRole("button", { name: "按日期删除" }).click();
    let confirmation = page.getByRole("dialog", { name: "按日期永久删除已归档任务" });
    await expect(confirmation).toContainText("2026/4/24");
    await confirmation.getByRole("button", { name: "取消", exact: true }).click();
    expect(cutoffs).toHaveLength(0);

    await range.click();
    await page.getByRole("option", { name: "3 个月前", exact: true }).click();
    // 搜索只显示近期任务，批量日期清理仍应在全部归档中选择旧任务。
    await dialog.getByRole("textbox", { name: "搜索已归档任务" }).fill("近期");
    await expect(dialog.getByText("很早的归档", { exact: true })).not.toBeVisible();
    await dialog.getByRole("button", { name: "按日期删除" }).click();
    confirmation = page.getByRole("dialog", { name: "按日期永久删除已归档任务" });
    await expect(confirmation).toContainText("2026/7/24");
    await expect(confirmation).toContainText("最后更新时间");
    await confirmation.getByRole("button", { name: "永久删除", exact: true }).click();
    await expect.poll(() => [...deleted]).toEqual(["old"]);
    expect(cutoffs[0]).toBe(await page.evaluate(() => new Date(2026, 6, 24).toISOString()));

    await expect(confirmation).not.toBeVisible();
    await range.click();
    await page.getByRole("option", { name: "1 个月前", exact: true }).click();
    await expect(dialog.locator('input[type="date"]')).toHaveCount(0);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await dialog.getByRole("button", { name: "按日期删除" }).click();
    confirmation = page.getByRole("dialog", { name: "按日期永久删除已归档任务" });
    await expect(confirmation).toContainText("2026/9/24");
    await confirmation.getByRole("button", { name: "永久删除", exact: true }).click();
    await expect.poll(() => [...deleted]).toEqual(["old", "boundary"]);
    await expect(dialog.getByText("近期归档", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(dialog).not.toBeVisible();
  });
}
