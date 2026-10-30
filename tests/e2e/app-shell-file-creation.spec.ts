import {
  expect,
  parseRequestRecord,
  projectFileTreeByDirectory,
  test,
} from "./fixtures/app-shell.js";

for (const mobile of [false, true]) {
  test.describe(mobile ? "触屏项目树" : "桌面项目树", () => {
    if (mobile) test.use({ hasTouch: true });
    test(`creates files and folders through project tree menus ${mobile ? "on mobile" : "on desktop"} @cross-browser`, async ({
      page,
    }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      const requests: Record<string, unknown>[] = [];
      const trees = new Map(projectFileTreeByDirectory);
      await page.route("**/v1/projects/codexly/files/create?*", async (route) => {
        const input = parseRequestRecord(route.request().postData());
        requests.push(input);
        const parentPath = input["parentPath"] as string | null;
        const path = [parentPath, input["name"]].filter(Boolean).join("/");
        const tree = {
          path: parentPath,
          entries: [
            ...(trees.get(parentPath)?.entries ?? []),
            { path, type: input["type"] as "file" | "directory" },
          ],
        };
        trees.set(parentPath, tree);
        await route.fulfill({ json: { path, tree } });
      });
      await page.goto("/p/codexly/t/task-1");
      if (mobile) await page.getByRole("button", { name: "展开上下文面板" }).tap();
      const inspector = page.getByRole("complementary", { name: "运行环境" });
      await inspector.getByRole("tab", { name: "项目", exact: true })[mobile ? "tap" : "click"]();
      const tree = inspector.getByRole("tree", { name: "项目文件" });
      const root = tree.getByRole("treeitem", { name: "Codexly", exact: true });
      if (!mobile) await root.hover();
      await root
        .getByRole("button", { name: "/workspace/Codexly 的操作" })
        [mobile ? "tap" : "click"]();
      await page
        .getByRole("menuitem", { name: "新建文件", exact: true })
        [mobile ? "tap" : "click"]();
      const dialog = page.getByRole("dialog", { name: "新建文件", exact: true });
      await expect(dialog.getByRole("textbox", { name: "名称" })).toBeFocused();
      await dialog.getByRole("textbox", { name: "名称" }).fill("CON");
      await expect(dialog.getByRole("button", { name: "创建", exact: true })).toBeDisabled();
      await dialog.getByRole("textbox", { name: "名称" }).fill("中文文件.txt");
      await dialog.getByRole("button", { name: "创建", exact: true })[mobile ? "tap" : "click"]();
      await expect(tree.getByRole("treeitem", { name: "中文文件.txt", exact: true })).toBeVisible();
      expect(requests[0]).toEqual({ parentPath: null, name: "中文文件.txt", type: "file" });

      const docs = tree.getByRole("treeitem", { name: "docs", exact: true });
      if (mobile) {
        await docs.getByRole("button", { name: "docs 的操作" }).tap();
      } else await docs.click({ button: "right" });
      await page
        .getByRole("menuitem", { name: "新建文件夹", exact: true })
        [mobile ? "tap" : "click"]();
      const folderDialog = page.getByRole("dialog", { name: "新建文件夹", exact: true });
      await folderDialog.getByRole("textbox", { name: "名称" }).fill("新文件夹");
      await folderDialog
        .getByRole("button", { name: "创建", exact: true })
        [mobile ? "tap" : "click"]();
      await expect(tree.getByRole("treeitem", { name: "新文件夹", exact: true })).toBeVisible();
      expect(requests[1]).toEqual({ parentPath: "docs", name: "新文件夹", type: "directory" });
    });
  });
}
