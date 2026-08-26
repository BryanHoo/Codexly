import {
  expect,
  parseRequestRecord,
  projectGitStatus,
  taskSnapshot,
  taskSnapshotResponse,
  test,
} from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("opens timeline review while showing Git stats in the Inspector project tree", async ({
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
  await expect(contextTab).toHaveAttribute("aria-selected", "true");

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

  const changedFiles = page.getByRole("region", { name: "本次修改了 2 个文件" });
  const timelineReviewButton = changedFiles.getByRole("button", { name: "审核", exact: true });
  const gitChanges = inspector.getByRole("region", { name: "未提交变更" });
  const commitButton = gitChanges.getByRole("button", { name: "提交 2 个未提交变更" });
  const changeStats = gitChanges.getByRole("button", { name: "查看 2 个未提交变更" });
  await expect(page.getByRole("button", { name: "审核 2 个未提交变更" })).toHaveCount(0);
  await expect(commitButton).toHaveText("提交");
  await expect(changeStats).toHaveText("2 个变更+2-1");
  await expect(gitChanges.getByRole("tree", { name: "变更文件导航" })).toHaveCount(0);
  await expect(gitChanges.getByText("package.json", { exact: true })).toHaveCount(0);
  await projectTab.click();
  await expect(inspector.getByRole("region", { name: "未提交变更" })).toHaveCount(0);
  await expect(
    inspector
      .getByRole("tree", { name: "项目文件" })
      .getByLabel("package.json，新增 1 行，删除 1 行"),
  ).toHaveCount(1);
  await contextTab.click();
  const [statsBox, commitBox] = await Promise.all([
    changeStats.boundingBox(),
    commitButton.boundingBox(),
  ]);
  expect(statsBox?.x).toBeLessThan(commitBox?.x ?? 0);
  await timelineReviewButton.click();
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
  await changesTab.click();
  await expect(inspector.getByRole("button", { name: "切换为文件列表" })).toBeVisible();

  // 刷新后右栏仍保持树，审核弹窗独立恢复列表偏好。
  await page.reload();
  await inspector.getByRole("tab", { name: "变更" }).click();
  await expect(inspector.getByRole("button", { name: "切换为文件列表" })).toBeVisible();
  await inspector.getByRole("tab", { name: "上下文" }).click();
  await page.getByRole("button", { name: "审核", exact: true }).click();
  await expect(reviewDialog.getByRole("listbox", { name: "变更文件导航" })).toBeVisible();
  await expect(reviewDialog.getByRole("button", { name: "切换为文件树" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect({ consoleErrors, failedResources }).toEqual({ consoleErrors: [], failedResources: [] });
});

test("generates a message and commits only selected files", async ({ page }) => {
  const snapshot = "c".repeat(64);
  const additionalChanges = Array.from({ length: 16 }, (_, index) => ({
    diff: `+export const generated${String(index + 1)} = true;`,
    kind: "create",
    path: `apps/web/src/generated-${String(index + 1).padStart(2, "0")}.ts`,
  }));
  let messageRequest: Record<string, unknown> | undefined;
  let commitRequest: Record<string, unknown> | undefined;
  let commitIdempotencyKey: string | undefined;
  let historyRequestCount = 0;
  await page.route("**/v1/projects/codexly/git/status*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...projectGitStatus,
        snapshot,
        unstaged: [...projectGitStatus.unstaged, ...additionalChanges],
      },
    });
  });
  await page.route("**/v1/projects/codexly/git/commit-message?*", async (route) => {
    messageRequest = parseRequestRecord(route.request().postData());
    await route.fulfill({
      contentType: "application/json",
      json: { message: "feat(git): 生成选中文件提交", snapshot },
    });
  });
  await page.route("**/v1/projects/codexly/git/commits?*", async (route) => {
    commitRequest = parseRequestRecord(route.request().postData());
    commitIdempotencyKey = route.request().headers()["idempotency-key"];
    await route.fulfill({
      contentType: "application/json",
      json: {
        branch: "feat/review-targets",
        commitSha: "0123456789abcdef0123456789abcdef01234567",
        message: commitRequest["message"],
        pushError: "fatal: remote rejected",
        pushStatus: "failed",
      },
      status: 201,
    });
  });
  await page.route("**/v1/projects/codexly/git/history*", async (route) => {
    historyRequestCount += 1;
    await route.fulfill({
      contentType: "application/json",
      json: {
        branch: "feat/review-targets",
        commits: [],
        nextCursor: null,
        repositories: [],
        repository: null,
        repositoryMode: "root",
      },
    });
  });

  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("button", { name: "提交 17 个未提交变更" }).click();
  const inspector = page.locator(".workbench-inspector");
  const changesTab = inspector.getByRole("tab", { name: "变更" });
  const panel = inspector.locator('[data-slot="commit-changes-panel"]');
  await expect(changesTab).toHaveAttribute("aria-selected", "true");
  await expect(panel).toBeVisible();
  await expect(page.locator('[data-slot="sheet-content"]')).toHaveCount(0);
  const unstagedTree = panel.getByRole("tree", { name: "未暂存" });
  const allFilesCheckbox = panel.getByRole("checkbox", { name: "未暂存", exact: true });
  const generateMessageButton = panel.getByRole("button", { name: "生成 message 信息" });
  await expect(allFilesCheckbox).toBeChecked();
  await expect(generateMessageButton).toHaveCSS("height", "28px");
  await expect(generateMessageButton).toHaveCSS("width", "28px");
  await expect(generateMessageButton).toHaveText("");
  const inputGroup = panel.locator('[data-slot="input-group"]');
  const generateIcon = generateMessageButton.locator("svg");
  const [inputGroupBox, generateButtonBox, generateIconBox] = await Promise.all([
    inputGroup.boundingBox(),
    generateMessageButton.boundingBox(),
    generateIcon.boundingBox(),
  ]);
  expect(
    Math.abs(
      (inputGroupBox?.x ?? 0) +
        (inputGroupBox?.width ?? 0) -
        (generateButtonBox?.x ?? 0) -
        (generateButtonBox?.width ?? 0),
    ),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      (generateButtonBox?.x ?? 0) +
        (generateButtonBox?.width ?? 0) / 2 -
        (generateIconBox?.x ?? 0) -
        (generateIconBox?.width ?? 0) / 2,
    ),
  ).toBeLessThanOrEqual(1);
  await generateMessageButton.hover();
  await expect(page.getByRole("tooltip")).toHaveText("生成 message 信息");
  const messageInput = panel.getByRole("textbox", { name: "提交信息" });
  await expect(messageInput).toHaveJSProperty("tagName", "TEXTAREA");
  const changesScroll = panel.locator('[data-slot="commit-changes-scroll"]');
  const panelMetrics = await panel.evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
  }));
  await changesScroll.evaluate((element) => {
    // 模拟超长变更列表，验证滚动被限制在面板文件区域。
    const spacer = document.createElement("div");
    spacer.setAttribute("aria-hidden", "true");
    spacer.style.height = "1200px";
    element.append(spacer);
  });
  const changesScrollMetrics = await changesScroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return {
      clientHeight: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    };
  });
  expect(panelMetrics.scrollHeight).toBeLessThanOrEqual(panelMetrics.clientHeight);
  expect(panelMetrics.overflowY).toBe("hidden");
  expect(changesScrollMetrics.scrollHeight).toBeGreaterThan(changesScrollMetrics.clientHeight);
  expect(changesScrollMetrics.overflowY).toBe("auto");
  expect(changesScrollMetrics.scrollTop).toBeGreaterThan(0);
  expect(await panel.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(panel).not.toContainText("feat/review-targets");
  await expect(panel.getByText("当前分支历史")).toHaveCount(0);
  expect(historyRequestCount).toBe(0);

  const packageFile = unstagedTree.getByRole("treeitem", { name: "package.json" });
  await packageFile.click();
  const fileDiffDialog = page.getByRole("dialog", { name: "package.json" });
  await expect(fileDiffDialog).toBeVisible();
  await expect(fileDiffDialog.locator(".file-diff-renderer")).toContainText("pnpm run dev");
  await fileDiffDialog.getByRole("button", { name: "关闭文件 Diff" }).click();
  await expect(fileDiffDialog).not.toBeAttached();
  await expect(allFilesCheckbox).toBeChecked();

  await allFilesCheckbox.uncheck();
  const packageCheckbox = unstagedTree.getByRole("checkbox", {
    name: "未暂存: package.json",
  });
  await expect(packageCheckbox).not.toBeChecked();
  await packageCheckbox.check();
  await generateMessageButton.click();
  await expect(messageInput).toHaveValue("feat(git): 生成选中文件提交");
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
  await messageInput.fill("feat(git): 提交选中文件\n\n保留提交正文");
  const messageMetrics = await messageInput.evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
  }));
  expect(messageMetrics.scrollHeight).toBeGreaterThan(messageMetrics.clientHeight);
  expect(messageMetrics.overflowY).toBe("auto");
  await messageInput.fill("feat(git): 提交选中文件");
  await expect(panel.getByRole("button", { name: "提交", exact: true }).locator("svg")).toHaveCSS(
    "width",
    "16px",
  );
  await panel.getByRole("button", { name: "选择提交方式" }).click();
  await expect(page.getByRole("menuitem", { name: "提交并推送" }).locator("svg")).toHaveCSS(
    "width",
    "14px",
  );
  await page.getByRole("menuitem", { name: "提交并推送" }).click();

  await expect(panel.getByText("提交已完成，但推送失败")).toHaveCount(0);
  const pushErrorToast = page.locator('[data-sonner-toast][data-type="error"]');
  await expect(pushErrorToast).toHaveText("fatal: remote rejected");
  expect(messageRequest).toEqual({ expectedSnapshot: snapshot, paths: ["package.json"] });
  expect(commitRequest).toEqual({
    action: "commit_and_push",
    expectedSnapshot: snapshot,
    message: "feat(git): 提交选中文件",
    paths: ["package.json"],
  });
  expect(commitIdempotencyKey).toBeTruthy();
  expect(historyRequestCount).toBe(0);

  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole("button", { name: "展开上下文面板" }).click();
  const mobilePanel = page.locator('[data-slot="commit-changes-panel"]');
  await expect(mobilePanel).toBeVisible();
  expect(await mobilePanel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
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
  test(`${scenario.actionName}成功后保留变更标签并显示 toast`, async ({ page }) => {
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
        },
        status: 201,
      });
    });
    await page.goto("/p/codexly/t/task-1");
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

    await expect(inspector.getByRole("tab", { name: "变更" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(panel).toContainText("0123456");
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
