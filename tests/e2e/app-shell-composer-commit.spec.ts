import {
  expect,
  parseRequestRecord,
  projectGitStatus,
  taskSnapshot,
  taskSnapshotResponse,
  test,
} from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("opens project review while showing Git stats in the Inspector project tree", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const failedResources: string[] = [];
  const reviewListChange = {
    diff: `+export const reviewList = "${"wide-diff-content-".repeat(40)}";`,
    kind: "create" as const,
    path: "apps/web/src/review-list.tsx",
  };
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshot,
          turns: taskSnapshot.turns.map((turn) => ({
            ...turn,
            items: turn.items.map((item) =>
              item.type === "file_change"
                ? { ...item, changes: [...(item.changes ?? []), reviewListChange] }
                : item,
            ),
          })),
        },
      },
    });
  });
  await page.route("**/v1/projects/codexly/git/status*", async (route) => {
    // 此用例使用两个不同目录的文件，覆盖紧凑树路径与四方向导航，避免改变全局 Fixture。
    const detailedStatus = {
      ...projectGitStatus,
      unstaged: [...projectGitStatus.unstaged, reviewListChange],
    };
    const includeDiff = new URL(route.request().url()).searchParams.get("includeDiff") === "true";
    await route.fulfill({
      contentType: "application/json",
      json: includeDiff
        ? detailedStatus
        : {
            ...detailedStatus,
            unstaged: detailedStatus.unstaged.map((change) => ({ ...change, diff: "" })),
          },
    });
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedResources.push(response.url());
    }
  });
  await page.goto("/p/codexly/t/task-1");

  const inspector = page.getByRole("complementary", { name: "运行环境" });
  const contextTab = inspector.getByRole("tab", { name: "上下文" });
  const changesTab = inspector.getByRole("tab", { name: "变更" });
  const projectTab = inspector.getByRole("tab", { name: "项目" });
  await expect(projectTab).toHaveAttribute("aria-selected", "true");

  await expect(page.getByRole("region", { name: "本次修改了 2 个文件" })).toHaveCSS(
    "margin-top",
    "16px",
  );
  await page.getByRole("button", { name: /已编辑 package\.json.*打开 Diff/ }).click();
  const timelineDiffPanel = inspector.getByRole("region", { name: "package.json" });
  await expect(inspector.getByRole("tab", { name: "文件" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(timelineDiffPanel.locator(".file-diff-renderer")).toContainText("pnpm run dev");
  await expect(timelineDiffPanel.locator(".file-diff-renderer")).toContainText(
    "node ./dist/cli.js",
  );
  await expect(page.getByRole("dialog", { name: "package.json" })).toHaveCount(0);
  await inspector.getByRole("button", { name: "关闭文件" }).click();
  await contextTab.click();

  await expect(inspector.getByRole("region", { name: "未提交变更" })).toHaveCount(0);
  await projectTab.click();
  const gitChanges = inspector.getByRole("region", { name: "未提交变更" });
  const reviewButton = gitChanges.getByRole("button", { name: "审核 2 个未提交变更" });
  const commitButton = gitChanges.getByRole("button", { name: "提交 2 个未提交变更" });
  const changeCount = gitChanges.locator("[data-git-change-count]");
  const changeStats = gitChanges.locator("[data-git-change-stats]");
  await expect(reviewButton).toHaveText("审核");
  await expect(commitButton).toHaveText("提交");
  await expect
    .poll(() => reviewButton.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe("rgba(0, 0, 0, 0)");
  await expect(changeCount).toHaveText("2 个文件");
  await expect(changeStats).toHaveText("+2-1");
  await expect(gitChanges.locator("svg")).toHaveCount(0);
  await expect(gitChanges.getByRole("tree", { name: "变更文件导航" })).toHaveCount(0);
  await expect(gitChanges.getByText("package.json", { exact: true })).toHaveCount(0);
  await expect(
    inspector
      .getByRole("tree", { name: "项目文件" })
      .getByLabel("package.json，新增 1 行，删除 1 行"),
  ).toHaveCount(1);
  const [countBox, statsBox, commitBox] = await Promise.all([
    changeCount.boundingBox(),
    changeStats.boundingBox(),
    commitButton.boundingBox(),
  ]);
  const countCenter = (countBox?.y ?? 0) + (countBox?.height ?? 0) / 2;
  const statsCenter = (statsBox?.y ?? 0) + (statsBox?.height ?? 0) / 2;
  expect(Math.abs(countCenter - statsCenter)).toBeLessThanOrEqual(2);
  expect(countBox?.x).toBeLessThan(commitBox?.x ?? 0);
  expect(statsBox?.x).toBeLessThan(commitBox?.x ?? 0);
  await reviewButton.click();
  const reviewDialog = page.getByRole("dialog");
  const reviewContent = reviewDialog.getByRole("region", { name: "审核文件内容" });
  const reviewNavigation = reviewDialog.getByRole("complementary", { name: "变更文件导航" });
  await expect(reviewNavigation).toBeVisible();
  await expect(reviewDialog.getByRole("button", { name: "收起变更文件导航" })).toBeVisible();
  const changedFileTree = reviewDialog.getByRole("tree", { name: "变更文件导航" });
  const packageFileTreeItem = changedFileTree.getByRole("treeitem", {
    name: "package.json，新增 1 行，删除 1 行",
  });
  const reviewFileTreeItem = changedFileTree.getByRole("treeitem", {
    name: "apps/web/src/review-list.tsx，新增 1 行，删除 0 行",
  });
  await expect(reviewDialog).toHaveAccessibleName("package.json");
  await expect(
    changedFileTree.getByRole("button", { name: "收起文件夹 apps/web/src", exact: true }),
  ).toBeVisible();
  await expect(packageFileTreeItem).toHaveAttribute("aria-selected", "true");
  await expect(reviewFileTreeItem).toBeVisible();
  const [reviewContentBox, reviewNavigationBox] = await Promise.all([
    reviewContent.boundingBox(),
    reviewNavigation.boundingBox(),
  ]);
  expect(reviewContentBox?.x).toBeLessThan(reviewNavigationBox?.x ?? 0);
  await reviewContent.evaluate((element) => {
    // 模拟长 Diff，确保左侧审核区产生真实滚动距离。
    const spacer = document.createElement("div");
    spacer.setAttribute("aria-hidden", "true");
    spacer.style.height = "2000px";
    element.append(spacer);
  });
  await reviewContent.evaluate((element) => {
    element.scrollTop = 320;
  });
  await expect
    .poll(() => reviewContent.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await reviewFileTreeItem.click();
  await expect(reviewDialog).toHaveAccessibleName("review-list.tsx");
  await expect.poll(() => reviewContent.evaluate((element) => element.scrollTop)).toBe(0);
  await packageFileTreeItem.click();
  await expect(reviewDialog).toHaveAccessibleName("package.json");
  await page.keyboard.press("ArrowDown");
  await expect(reviewDialog).toHaveAccessibleName("review-list.tsx");
  const horizontalDiffScroller = reviewContent.locator("[data-code]");
  await expect
    .poll(() =>
      horizontalDiffScroller.evaluate((element) => element.scrollWidth > element.clientWidth),
    )
    .toBe(true);
  await horizontalDiffScroller.hover();
  await page.mouse.wheel(240, 0);
  await expect
    .poll(() => horizontalDiffScroller.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  await expect(reviewContent.locator(".file-diff-renderer")).toContainText(
    "export const reviewList",
  );
  await expect(reviewFileTreeItem).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowUp");
  await expect(reviewDialog).toHaveAccessibleName("package.json");
  await reviewDialog.getByRole("button", { name: "切换为文件列表" }).click();
  const changedFileList = reviewDialog.getByRole("listbox", { name: "变更文件导航" });
  await expect(changedFileList).toBeVisible();
  await expect(
    changedFileList.getByRole("option", {
      name: "apps/web/src/review-list.tsx，新增 1 行，删除 0 行",
    }),
  ).toBeVisible();
  await expect(reviewDialog.getByRole("tree", { name: "变更文件导航" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(reviewDialog).not.toBeAttached();
  await commitButton.click();
  await expect(changesTab).toHaveAttribute("aria-selected", "true");
  await expect(inspector.getByRole("button", { name: "切换为文件列表" })).toBeVisible();

  // 刷新后右栏仍保持树，审核弹窗独立恢复列表偏好。
  await page.reload();
  await inspector.getByRole("tab", { name: "变更" }).click();
  await expect(inspector.getByRole("button", { name: "切换为文件列表" })).toBeVisible();
  await inspector.getByRole("tab", { name: "项目" }).click();
  await inspector.getByRole("button", { name: "审核 2 个未提交变更" }).click();
  await expect(reviewDialog.getByRole("listbox", { name: "变更文件导航" })).toBeVisible();
  await expect(reviewDialog.getByRole("button", { name: "切换为文件树" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect({ consoleErrors, failedResources }).toEqual({ consoleErrors: [], failedResources: [] });
});

test("defaults to the first child repository and keeps the changes panel mounted when switching", async ({
  page,
}) => {
  const aggregateSnapshot = "a".repeat(64);
  const backendSnapshot = "b".repeat(64);
  const frontendSnapshot = "c".repeat(64);
  const requestedRepositories: string[] = [];
  await page.route("**/v1/projects/codexly/git/status*", async (route) => {
    const repository = new URL(route.request().url()).searchParams.get("repository");
    if (repository !== null) requestedRepositories.push(repository);
    const status =
      repository === "backend"
        ? {
            ...projectGitStatus,
            branch: "feat/backend",
            snapshot: backendSnapshot,
            staged: [],
            unstaged: [{ diff: "+backend", kind: "update", path: "src/server.ts" }],
          }
        : repository === "frontend"
          ? {
              ...projectGitStatus,
              branch: "feat/frontend",
              snapshot: frontendSnapshot,
              staged: [],
              unstaged: [{ diff: "+frontend", kind: "update", path: "src/app.tsx" }],
            }
          : {
              baseBranches: [],
              branch: null,
              branches: [],
              repositoryMode: "children",
              snapshot: aggregateSnapshot,
              staged: [],
              unstaged: [
                { diff: "+backend", kind: "update", path: "backend/src/server.ts" },
                { diff: "+frontend", kind: "update", path: "frontend/src/app.tsx" },
              ],
            };
    await route.fulfill({ contentType: "application/json", json: status });
  });
  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("tab", { name: "项目" }).click();
  await page.getByRole("button", { name: "提交 2 个未提交变更" }).click();
  const panel = page.locator('[data-slot="commit-changes-panel"]');
  const repositorySelect = panel.getByRole("combobox", { name: "Git 项目" });
  await expect(repositorySelect).toContainText("backend");
  await expect(panel.getByRole("treeitem", { name: "src/server.ts" })).toBeVisible();
  await panel.getByRole("textbox", { name: "提交信息" }).fill("fix(backend): 更新服务");
  await panel.evaluate((element) => {
    element.dataset["mountMarker"] = "stable";
  });

  await repositorySelect.click();
  await page.getByRole("option", { name: "frontend" }).click();

  await expect(repositorySelect).toContainText("frontend");
  await expect(panel).toHaveAttribute("data-mount-marker", "stable");
  await expect(panel.getByRole("treeitem", { name: "src/app.tsx" })).toBeVisible();
  await expect(panel.getByRole("textbox", { name: "提交信息" })).toHaveValue("");
  expect(requestedRepositories).toEqual(["backend", "frontend"]);
});

for (const scenario of [
  { actionName: "提交", pushStatus: "not_requested", toastMessage: "提交成功" },
  { actionName: "提交并推送", pushStatus: "pushed", toastMessage: "提交并推送成功" },
] as const) {
  test(`${scenario.actionName}成功后隐藏变更标签并回到第一个标签`, async ({ page }) => {
    await page.route("**/v1/projects/codexly/git/status*", async (route) => {
      await route.fulfill({ contentType: "application/json", json: projectGitStatus });
    });
    await page.route("**/v1/projects/codexly/git/commits?*", async (route) => {
      const request = parseRequestRecord(route.request().postData());
      await route.fulfill({
        contentType: "application/json",
        json: {
          branch: "feat/review-targets",
          commitSha: "0123456789abcdef0123456789abcdef01234567",
          message: request["message"],
          pushError: null,
          pushStatus: scenario.pushStatus,
          status: { ...projectGitStatus, snapshot: "d".repeat(64), staged: [], unstaged: [] },
          history: {
            branch: "feat/review-targets",
            commits: [],
            nextCursor: null,
            repositories: [],
            repository: null,
            repositoryMode: "root",
          },
        },
        status: 201,
      });
    });
    await page.goto("/p/codexly/t/task-1");
    await page.getByRole("tab", { name: "项目" }).click();
    await page.getByRole("button", { name: /提交 \d+ 个未提交变更/u }).click();
    const inspector = page.locator(".workbench-inspector");
    const panel = inspector.locator('[data-slot="commit-changes-panel"]');
    await panel.getByRole("textbox", { name: "提交信息" }).fill("fix(git): 验证提交成功反馈");
    if (scenario.actionName === "提交并推送") {
      await panel.getByRole("button", { name: "选择提交方式" }).click();
      await page.getByRole("menuitem", { name: "提交并推送" }).click();
    } else {
      await panel.getByRole("button", { name: scenario.actionName, exact: true }).click();
    }

    await expect(inspector.getByRole("tab", { name: "变更" })).toHaveCount(0);
    await expect(inspector.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
    await expect(panel).toHaveCount(0);
    await expect(inspector).not.toContainText("0123456");
    await expect(page.locator('[data-slot="sheet-content"]')).toHaveCount(0);
    const toaster = page.locator("[data-sonner-toaster]");
    await expect(toaster).toHaveAttribute("data-x-position", "center");
    await expect(toaster).toHaveAttribute("data-y-position", "top");
    const successToast = page.locator('[data-sonner-toast][data-type="success"]');
    await expect(successToast).toBeVisible();
    await expect(successToast).toHaveText(scenario.toastMessage);
    await expect(successToast.getByRole("button", { name: "关闭通知" })).toHaveCount(0);
    await expect(successToast).not.toBeAttached({ timeout: 7_000 });
  });
}
