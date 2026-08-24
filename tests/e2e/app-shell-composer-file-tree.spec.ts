import { expect, parseRequestRecord, test } from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("project file tree refresh, context menu, and ellipsis share target actions", async ({
  page,
}) => {
  let turnRequest: Record<string, unknown> | undefined;
  await page.route("**/v1/projects/codexly/tasks/task-1/turns", async (route) => {
    turnRequest = parseRequestRecord(route.request().postData());
    await route.fulfill({
      contentType: "application/json",
      json: {
        taskId: "task-1",
        turn: {
          completedAt: null,
          error: null,
          id: "inspector-file-reference-turn",
          items: [],
          startedAt: "2026-08-11T00:00:00.000Z",
          status: "running",
        },
      },
      status: 201,
    });
  });
  await page.goto("/p/codexly/t/task-1");

  const inspector = page.getByRole("complementary", { name: "运行环境" });
  await inspector.getByRole("tab", { name: "项目" }).click();
  const fileTree = inspector.getByRole("tree", { name: "项目文件" });
  const selectOpenApp = async (name: string) => {
    const item = page.getByRole("menuitem", { name });
    await expect(item).toBeVisible();
    await item.focus();
    await item.press("Enter");
  };
  await expect(fileTree.getByRole("button", { name: "在 Zed 中打开" })).toHaveCount(0);

  const rootRequest = page.waitForRequest((request) => {
    if (!/^\/v1\/projects\/codexly\/open$/u.test(new URL(request.url()).pathname)) {
      return false;
    }
    const body = parseRequestRecord(request.postData());
    return body["appId"] === "finder" && !("path" in body);
  });
  const rootTreeItem = fileTree.getByRole("treeitem", { name: "Codexly" }).first();
  await expect(rootTreeItem).toHaveAttribute("aria-expanded", "true");
  const rootRefresh = rootTreeItem.getByRole("button", { name: "刷新项目 Codexly" });
  const rootTreeRefreshRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/v1/projects/codexly/files/tree" && !url.searchParams.has("path");
  });
  const gitRefreshRequest = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/v1/projects/codexly/git/status",
  );
  await expect(rootRefresh).toHaveClass(/opacity-0/u);
  await expect(rootRefresh.locator("svg")).toHaveCSS("width", "14px");
  await expect(rootRefresh.locator("svg")).toHaveCSS("height", "14px");
  await rootTreeItem.locator(":scope > div").first().hover();
  await expect(rootRefresh).toHaveCSS("opacity", "1");
  await rootRefresh.click();
  await Promise.all([rootTreeRefreshRequest, gitRefreshRequest]);
  await rootTreeItem.click({ button: "right" });
  const rootMenu = page.getByRole("menu", { name: "/workspace/Codexly 的操作" });
  await expect(rootMenu.getByRole("menuitem", { name: "复制名称" })).toBeVisible();
  await expect(rootMenu.getByRole("menuitem", { name: "复制相对路径" })).toBeVisible();
  await expect(rootMenu.getByRole("menuitem", { name: "复制绝对路径" })).toBeVisible();
  await expect(rootMenu.getByRole("menuitem", { name: "引用" })).toHaveCount(0);
  await rootMenu.getByRole("menuitem", { name: "复制名称" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("Codexly");
  await rootTreeItem.click({ button: "right" });
  await rootMenu.getByRole("menuitem", { name: "复制相对路径" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(".");
  await rootTreeItem.click({ button: "right" });
  await rootMenu.getByRole("menuitem", { name: "复制绝对路径" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("/workspace/Codexly");
  await rootTreeItem.click({ button: "right" });
  await rootMenu.getByRole("menuitem", { name: "打开" }).click();
  await selectOpenApp("Finder");
  await rootRequest;
  await expect(rootMenu).not.toBeAttached();

  const folderRequest = page.waitForRequest((request) => {
    if (!/^\/v1\/projects\/codexly\/open$/u.test(new URL(request.url()).pathname)) {
      return false;
    }
    const body = parseRequestRecord(request.postData());
    return body["appId"] === "finder" && body["path"] === "docs";
  });
  const docsTreeItem = fileTree.getByRole("treeitem", { name: "docs" });
  const docsExpandButton = docsTreeItem.getByRole("button", { name: "展开文件夹 docs" });
  await expect(docsExpandButton).toBeVisible();
  await docsTreeItem.click({ button: "right" });
  const folderMenu = page.getByRole("menu", { name: "docs 的操作" });
  await expect(folderMenu).toBeVisible();
  await expect(folderMenu.getByRole("menuitem", { name: "复制名称" })).toBeVisible();
  await expect(folderMenu.getByRole("menuitem", { name: "复制相对路径" })).toBeVisible();
  await expect(folderMenu.getByRole("menuitem", { name: "复制绝对路径" })).toBeVisible();
  await expect(folderMenu.getByRole("menuitem", { name: "打开" })).toBeVisible();
  await expect(folderMenu.getByRole("menuitem", { name: "引用" })).toHaveCount(0);
  await expect(docsTreeItem).toHaveAttribute("aria-selected", "true");
  await folderMenu.getByRole("menuitem", { name: "复制相对路径" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("docs");
  await docsTreeItem.click({ button: "right" });
  await folderMenu.getByRole("menuitem", { name: "复制绝对路径" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("/workspace/Codexly/docs");
  await docsTreeItem.click({ button: "right" });
  await folderMenu.getByRole("menuitem", { name: "打开" }).click();
  await expect(page.getByRole("menuitem", { name: "系统默认应用" })).toHaveCount(0);
  await selectOpenApp("Finder");
  await folderRequest;
  await expect(folderMenu).not.toBeAttached();

  const folderActionRequest = page.waitForRequest((request) => {
    if (!/^\/v1\/projects\/codexly\/open$/u.test(new URL(request.url()).pathname)) {
      return false;
    }
    const body = parseRequestRecord(request.postData());
    return body["appId"] === "zed" && body["path"] === "docs";
  });
  const folderAction = docsTreeItem.getByRole("button", { name: "docs 的操作" });
  await expect(folderAction).toHaveClass(/opacity-0/u);
  await docsTreeItem.hover();
  await expect(docsTreeItem).toHaveCSS("background-color", "rgba(23, 23, 23, 0.075)");
  await expect(folderAction).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(folderAction).toHaveCSS("opacity", "1");
  await folderAction.click();
  const folderActionMenu = page.getByRole("menu", { name: "docs 的操作" });
  await folderActionMenu.getByRole("menuitem", { name: "打开" }).click();
  const folderActionMenuIcon = page.getByRole("menuitem", { name: "Zed" }).locator("svg");
  await expect(folderActionMenuIcon).toHaveCSS("width", "16px");
  await expect(folderActionMenuIcon).toHaveCSS("height", "16px");
  await selectOpenApp("Zed");
  await folderActionRequest;
  await expect(folderActionMenu).not.toBeAttached();

  const fileRequest = page.waitForRequest((request) => {
    if (!/^\/v1\/projects\/codexly\/open$/u.test(new URL(request.url()).pathname)) {
      return false;
    }
    const body = parseRequestRecord(request.postData());
    return body["appId"] === "system-default" && body["path"] === "package.json";
  });
  const packageTreeItem = fileTree.getByRole("treeitem", { name: /package\.json/u });
  await packageTreeItem.click({ button: "right" });
  const fileMenu = page.getByRole("menu", { name: "package.json 的操作" });
  await expect(packageTreeItem).toHaveAttribute("aria-selected", "true");
  await expect(packageTreeItem).toHaveClass(/bg-control/u);
  await fileMenu.getByRole("menuitem", { name: "打开" }).click();
  await selectOpenApp("系统默认应用");
  await fileRequest;
  await expect(fileMenu).not.toBeAttached();

  const fileActionRequest = page.waitForRequest((request) => {
    if (!/^\/v1\/projects\/codexly\/open$/u.test(new URL(request.url()).pathname)) {
      return false;
    }
    const body = parseRequestRecord(request.postData());
    return body["appId"] === "zed" && body["path"] === "package.json";
  });
  const fileAction = packageTreeItem.getByRole("button", { name: "package.json 的操作" });
  await packageTreeItem.hover();
  await expect(fileAction).toBeVisible();
  await fileAction.click();
  const fileActionMenu = page.getByRole("menu", { name: "package.json 的操作" });
  await fileActionMenu.getByRole("menuitem", { name: "打开" }).click();
  await selectOpenApp("Zed");
  await fileActionRequest;
  await expect(fileActionMenu).not.toBeAttached();

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await docsTreeItem.click({ button: "right" });
  await expect(folderMenu.getByRole("menuitem", { name: "引用" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await packageTreeItem.click({ button: "right" });
  await fileMenu.getByRole("menuitem", { name: "引用" }).click();
  await expect(
    prompt.getByRole("button", { name: "@/workspace/Codexly/package.json" }),
  ).toBeVisible();
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect.poll(() => turnRequest).toBeDefined();
  expect(turnRequest?.["input"]).toEqual({
    attachments: [],
    skills: [],
    text: "@/workspace/Codexly/package.json",
    type: "prompt",
  });
});
