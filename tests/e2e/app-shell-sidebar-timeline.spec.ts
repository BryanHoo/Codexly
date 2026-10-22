import { expect, tasks, test } from "./fixtures/app-shell.js";

test("切换时间线并保留项目展开、跨项目任务排序及视图偏好 @cross-browser", async ({ page }) => {
  const dates = [0, 1, 3, 8];
  const now = new Date();
  const timelineTasks = tasks.slice(0, 4).map((task, index) => ({
    ...task,
    projectId: index === 2 ? "superwork" : "codexly",
    updatedAt: new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - (dates[index] ?? 0),
      0,
    ).toISOString(),
  }));
  let catalogRequests = 0;
  await page.route("**/v1/projects/*/tasks?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("limit") !== "100") return route.fallback();
    await route.fulfill({
      json: {
        data: timelineTasks.filter((task) => task.projectId === url.pathname.split("/")[3]),
        nextCursor: null,
      },
    });
  });
  await page.route("**/v1/projects/*/tasks/catalog*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("pinned") === "true") return route.fallback();
    catalogRequests += 1;
    await route.fulfill({
      json: { data: timelineTasks.filter((task) => task.projectId === url.pathname.split("/")[3]) },
    });
  });
  await page.goto("/p/codexly");
  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  const folder = sidebar.getByRole("button", { name: "切换项目 Codexly" });
  await expect(folder).toHaveAttribute("aria-expanded", "true");
  expect(catalogRequests).toBe(0);
  await sidebar.getByRole("button", { name: "切换为时间线", exact: true }).click();
  const timeline = sidebar.getByTestId("sidebar-task-timeline");
  for (const group of ["今天", "昨天", "近 7 天", "更早"]) {
    await expect(timeline.getByRole("heading", { name: new RegExp(group) })).toBeVisible();
  }
  const earlier = timeline.getByRole("button", { name: /更早/ });
  await expect(earlier).toHaveAttribute("aria-expanded", "false");
  expect(catalogRequests).toBe(0);
  await earlier.click();
  await expect(timeline.getByRole("link")).toHaveText(
    timelineTasks
      .map((task) => `${task.projectId === "superwork" ? "superwork" : "Codexly"}${task.title}`)
      .map((text) => new RegExp(text)),
  );
  await expect(timeline.getByRole("link").nth(2)).toHaveAttribute(
    "href",
    `/p/superwork/t/${timelineTasks[2]?.id ?? ""}`,
  );
  await sidebar.getByRole("button", { name: "切换为项目分组", exact: true }).click();
  await expect(folder).toHaveAttribute("aria-expanded", "true");
  await sidebar.getByRole("button", { name: "切换为时间线", exact: true }).click();
  const today = timeline.getByRole("button", { name: /今天/ });
  await today.click();
  await expect(today).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(sidebar.getByTestId("sidebar-task-timeline")).toBeVisible();
  await expect(today).toHaveAttribute("aria-expanded", "false");
  await expect(earlier).toHaveAttribute("aria-expanded", "true");
});

test("时间线复用置顶与归档操作并立即更新列表", async ({ page }) => {
  await page.goto("/p/codexly");
  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  await sidebar.getByRole("button", { name: "切换为时间线", exact: true }).click();
  const timeline = sidebar.getByTestId("sidebar-task-timeline");
  await timeline.getByRole("button", { name: /更早/ }).click();
  const title = tasks[1]?.title ?? "";
  await timeline.getByRole("link", { name: new RegExp(title) }).hover();
  await timeline.getByRole("button", { name: `打开 ${title} 的操作菜单` }).click();
  await page.getByRole("menuitem", { name: "固定", exact: true }).click();
  await expect(
    sidebar.getByTestId("sidebar-task-shortcuts").getByRole("link", { name: new RegExp(title) }),
  ).toBeVisible();
  await timeline.getByRole("link", { name: new RegExp(title) }).hover();
  await timeline.getByRole("button", { name: `打开 ${title} 的操作菜单` }).click();
  await page.getByRole("menuitem", { name: "归档", exact: true }).click();
  await expect(timeline.getByRole("link", { name: new RegExp(title) })).toHaveCount(0);
});

test("移动端切换时间线后导航任务自动收起侧栏", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/p/codexly");
  await page.getByRole("button", { name: "展开项目侧栏", exact: true }).click();
  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  await sidebar.getByRole("button", { name: "切换为时间线", exact: true }).click();
  const toggle = sidebar.getByRole("button", { name: "切换为项目分组", exact: true });
  await expect(toggle).toBeVisible();
  const bounds = await toggle.boundingBox();
  expect((bounds?.x ?? 391) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
  await sidebar.getByTestId("sidebar-task-timeline").getByRole("button", { name: /更早/ }).click();
  await sidebar.getByTestId("sidebar-task-timeline").getByRole("link").first().click();
  await expect(sidebar).not.toBeVisible();
  await expect(page).toHaveURL(/\/p\/[^/]+\/t\/[^/]+$/u);
});
