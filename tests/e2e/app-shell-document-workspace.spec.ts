import { expect, test } from "./fixtures/app-shell.js";

test.beforeEach(async ({ page }) => {
  await page.route("**/v1/projects/codexly/files/text**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      contentType: "application/json",
      json: url.pathname.endsWith("/revision")
        ? { revision: "a".repeat(64) }
        : {
            path: url.searchParams.get("path") ?? "package.json",
            content: '{\n  "name": "codexly"\n}\n',
            version: "b".repeat(64),
            revision: "a".repeat(64),
          },
    });
  });
});

test("多文件标签支持鼠标与触控板滚动，并自动居中选择的标签 @cross-browser", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/v1/projects/codexly/files/tree*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        path: null,
        entries: Array.from({ length: 12 }, (_, index) => ({
          path: `document-${String(index)}.tsx`,
          type: "file",
        })),
      },
    });
  });
  await page.goto("/p/codexly/t/task-1");
  const tree = page.getByRole("tree", { name: "项目文件" });
  for (let index = 0; index < 12; index += 1) {
    await tree
      .getByRole("treeitem", { name: `document-${String(index)}.tsx`, exact: true })
      .click();
  }
  const list = page.getByRole("tablist", { name: "工作区标签" });
  const actions = page.locator(".document-workspace-actions");
  const actionBounds = await actions.boundingBox();
  await expect(actions.getByRole("button")).toHaveCount(3);
  for (const button of await actions.getByRole("button").all())
    await expect(button).toBeInViewport();
  const end = await list.evaluate((element) => element.scrollLeft);
  expect(end).toBeGreaterThan(0);
  await list.hover();
  await page.mouse.wheel(0, -250);
  await expect.poll(() => list.evaluate((element) => element.scrollLeft)).toBeLessThan(end);
  const previous = await list.evaluate((element) => element.scrollLeft);
  await page.mouse.wheel(-200, 0);
  await expect.poll(() => list.evaluate((element) => element.scrollLeft)).toBeLessThan(previous);
  expect(await actions.boundingBox()).toEqual(actionBounds);
  const middle = list.getByRole("tab", { name: "document-5.tsx", exact: true });
  await middle.click();
  await expect(middle).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(() =>
      list.evaluate((element) => {
        const viewport = element.getBoundingClientRect();
        const tab = element
          .querySelector('[aria-selected="true"]')
          ?.parentElement?.getBoundingClientRect();
        if (tab === undefined) return Number.POSITIVE_INFINITY;
        return Math.abs((tab.left + tab.right - viewport.left - viewport.right) / 2);
      }),
    )
    .toBeLessThan(2);
  await middle.press("End");
  await expect(list.getByRole("tab", { name: "document-11.tsx", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    list.getByRole("button", { name: "关闭 document-11.tsx", exact: true }),
  ).toBeInViewport();
});

test("文件在中栏打开并保留右栏导航、聊天草稿与对照布局 @cross-browser", async ({ page }) => {
  await page.goto("/p/codexly/t/task-1");
  const inspector = page.getByRole("complementary", { name: "运行环境" });
  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.fill("对照文件时保留这段草稿");
  await expect(page.locator(".document-workspace-toolbar")).toHaveCount(0);
  await inspector.getByRole("treeitem", { name: "package.json", exact: true }).click();
  const workspace = page.locator("[data-document-workspace]");
  await expect(workspace.getByRole("tab", { name: "package.json", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(inspector.getByRole("tab", { name: "项目", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    inspector.getByRole("treeitem", { name: "package.json", exact: true }),
  ).toBeVisible();
  await expect(prompt).toBeHidden();
  await expect(workspace.locator(".document-workspace-toolbar")).toHaveCSS("height", "28px");
  await expect(workspace.locator(".document-workspace-actions button")).toHaveCount(3);
  await expect(workspace.getByRole("combobox")).toHaveCount(0);
  for (const label of ["与聊天左右对照", "与聊天上下对照", "回到聊天"]) {
    await workspace.getByRole("button", { name: label, exact: true }).hover();
    await expect(page.getByRole("tooltip")).toHaveText(label);
  }
  await workspace.getByRole("button", { name: "与聊天左右对照" }).click();
  await expect(prompt).toBeVisible();
  await expect(prompt).toHaveValue("对照文件时保留这段草稿");
  await expect(workspace.getByRole("separator", { name: "调整聊天与文件大小" })).toBeVisible();
  const divider = workspace.getByRole("separator", { name: "调整聊天与文件大小" });
  await divider.focus();
  await divider.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "55");
  await workspace.getByRole("button", { name: "与聊天上下对照" }).click();
  await expect(workspace.locator('[data-direction="down"]')).toBeVisible();
  await workspace.getByRole("button", { name: "回到聊天", exact: true }).click();
  await expect(workspace.getByRole("tab", { name: "聊天", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(workspace.getByRole("tab", { name: "聊天", exact: true })).toBeFocused();
  await expect(workspace.getByRole("tab", { name: "package.json", exact: true })).toBeVisible();
  await expect(workspace.getByRole("separator")).toHaveCount(0);
  await expect(workspace.locator(".document-workspace-actions button")).toHaveCount(3);
  await expect(workspace.getByRole("button", { name: "与聊天左右对照" })).toBeDisabled();
  await expect(workspace.getByRole("button", { name: "回到聊天" })).toBeInViewport();
  await expect(prompt).toHaveValue("对照文件时保留这段草稿");
  await workspace.getByRole("tab", { name: "package.json", exact: true }).click();
  await workspace.getByRole("button", { name: "关闭 package.json", exact: true }).click();
  await expect(workspace.getByRole("tablist")).toHaveCount(0);
  await expect(prompt).toHaveValue("对照文件时保留这段草稿");
});

test("移动端打开文件收起覆盖层，切回聊天保留草稿 @cross-browser", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/p/codexly/t/task-1");
  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.fill("移动端草稿");
  await page.getByRole("button", { name: "展开上下文面板" }).click();
  const inspector = page.getByRole("complementary", { name: "运行环境" });
  await inspector.getByRole("treeitem", { name: "package.json", exact: true }).click();
  await expect(inspector).toBeHidden();
  const workspace = page.locator("[data-document-workspace]");
  await expect(workspace.getByRole("tabpanel", { name: "package.json" })).toBeVisible();
  await expect(workspace.getByRole("button", { name: "与聊天左右对照" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await workspace.getByRole("tab", { name: "聊天", exact: true }).click();
  await expect(prompt).toHaveValue("移动端草稿");
});

test("多任务分屏中打开文件只作用于聚焦窗口 @cross-browser", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("button", { name: "分屏布局", exact: true }).click();
  await page.getByRole("menuitem", { name: "双分屏 · 左右横排", exact: true }).click();
  const workspaces = page.locator("[data-document-workspace]");
  await expect(workspaces).toHaveCount(2);
  const first = workspaces.nth(0);
  const second = workspaces.nth(1);
  await second.getByRole("region", { name: "聊天", exact: true }).focus();
  const inspector = page.getByRole("complementary", { name: "运行环境" });
  await inspector.getByRole("treeitem", { name: "package.json", exact: true }).click();
  await expect(second.getByRole("tabpanel", { name: "package.json", exact: true })).toBeVisible();
  await expect(first.getByRole("region", { name: "聊天", exact: true })).toBeVisible();
  await expect(first.getByRole("tablist")).toHaveCount(0);
  await expect(first.getByRole("tab", { name: "package.json", exact: true })).toHaveCount(0);
  await first.getByRole("region", { name: "聊天", exact: true }).focus();
  await inspector.getByRole("treeitem", { name: "package.json", exact: true }).click();
  await expect(first.getByRole("tabpanel", { name: "package.json", exact: true })).toBeVisible();
  // 左栏任务导航恢复聊天；切换不关闭已打开文件，也不影响另一个任务的文档。
  await page
    .getByRole("complementary", { name: "项目侧栏" })
    .locator('a[href="/p/codexly/t/task-1"]')
    .last()
    .click();
  await expect(first.getByRole("tab", { name: "聊天", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(first.getByRole("tab", { name: "package.json", exact: true })).toBeVisible();
  await expect(second.getByRole("tabpanel", { name: "package.json", exact: true })).toBeVisible();
  await first.getByRole("tab", { name: "package.json", exact: true }).click();
  await second.getByRole("button", { name: "关闭 package.json", exact: true }).click();
  await expect(second.getByRole("tablist")).toHaveCount(0);
  await expect(second.getByRole("region", { name: "聊天", exact: true })).toBeVisible();
  await expect(first.getByRole("tabpanel", { name: "package.json", exact: true })).toBeVisible();
});
