import {
  expect,
  parseRequestRecord,
  projectGitStatus,
  taskSnapshotResponse,
  tasks,
  test,
} from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("switches branches from the composer footer", async ({ page }) => {
  let switchRequest: Record<string, unknown> | undefined;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname === "/v1/projects/codexly/git/branch") {
      switchRequest = parseRequestRecord(request.postData());
    }
  });
  await page.goto("/p/codexly/t/task-1");

  const trigger = page.getByRole("button", {
    name: "切换分支，当前分支 feat/review-targets",
  });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const branchMenu = page.getByRole("menu", {
    name: "切换分支，当前分支 feat/review-targets",
  });
  await expect(branchMenu.getByRole("menuitemradio", { name: "feat/review-targets" })).toHaveCount(
    0,
  );
  const mainBranch = branchMenu.getByRole("menuitemradio", { name: "main", exact: true });
  await expect(mainBranch).toBeEnabled();
  await mainBranch.click();

  await expect(page.getByRole("button", { name: "切换分支，当前分支 main" })).toBeVisible();
  expect(switchRequest).toEqual({
    branch: "main",
    expectedSnapshot: projectGitStatus.snapshot,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const viewportMetrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(viewportMetrics.documentWidth).toBeLessThanOrEqual(viewportMetrics.viewportWidth);
});

test("creates and switches to a branch from the composer footer", async ({ page }) => {
  let createRequest: Record<string, unknown> | undefined;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname === "/v1/projects/codexly/git/branches") {
      createRequest = parseRequestRecord(request.postData());
    }
  });
  await page.goto("/p/codexly/t/task-1");

  await page.getByRole("button", { name: "切换分支，当前分支 feat/review-targets" }).click();
  const createBranchItem = page.getByRole("menuitem", { name: "新建分支" });
  await expect(createBranchItem.locator("svg")).toHaveClass(/size-3\.5/u);
  await createBranchItem.click();
  const dialog = page.getByRole("dialog", { name: "新建分支" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("基于当前分支创建并立即切换");
  await dialog.getByRole("textbox", { name: "分支名称" }).fill("feat/composer-create");
  await dialog.getByRole("button", { name: "创建并切换" }).click();

  await expect(
    page.getByRole("button", { name: "切换分支，当前分支 feat/composer-create" }),
  ).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(createRequest).toEqual({
    branch: "feat/composer-create",
    expectedSnapshot: projectGitStatus.snapshot,
  });
});

test("keeps worktree task creation in the project sidebar", async ({ page }) => {
  await page.goto("/p/codexly/t/task-1");

  await page.getByRole("button", { name: "切换分支，当前分支 feat/review-targets" }).click();
  await expect(page.getByRole("menuitem", { name: /worktree/u })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "在 Codexly 中创建 worktree 任务" }).click();
  const dialog = page.getByRole("dialog", { name: "创建 worktree 任务" });
  await expect(dialog.getByRole("textbox", { name: "分支名称" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "创建 worktree 和任务" })).toBeDisabled();
});

test("creates a worktree task under its original project", async ({ page }) => {
  const worktreePath = "/workspace/Codexly-composer-worktree";
  const task = { ...tasks[0], id: "worktree-task-1", title: "新任务" };
  let worktreeRequest: Record<string, unknown> | undefined;
  let taskRequest: Record<string, unknown> | undefined;
  await page.route("**/v1/projects/codexly/git/task-worktrees?*", async (route) => {
    worktreeRequest = parseRequestRecord(route.request().postData());
    await route.fulfill({
      contentType: "application/json",
      json: { worktree: { branch: "feat/sidebar-worktree", current: false, path: worktreePath } },
    });
  });
  await page.route("**/v1/projects/codexly/tasks", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    taskRequest = parseRequestRecord(route.request().postData());
    await route.fulfill({ contentType: "application/json", json: { task } });
  });
  await page.route("**/v1/projects/codexly/tasks/worktree-task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { ...taskSnapshotResponse, snapshot: { ...taskSnapshotResponse.snapshot, ...task } },
    });
  });
  await page.goto("/p/codexly/t/task-1");

  await page.getByRole("button", { name: "在 Codexly 中创建 worktree 任务" }).click();
  const dialog = page.getByRole("dialog", { name: "创建 worktree 任务" });
  await dialog.getByRole("textbox", { name: "分支名称" }).fill("feat/sidebar-worktree");
  await dialog.getByRole("button", { name: "创建 worktree 和任务" }).click();

  await expect(page).toHaveURL(/\/p\/codexly\/t\/worktree-task-1$/u);
  expect(worktreeRequest).toEqual({
    branch: "feat/sidebar-worktree",
    expectedSnapshot: projectGitStatus.snapshot,
  });
  expect(taskRequest).toEqual({ rootPath: "/workspace/Codexly", worktreePath });
});

test("opens current-branch Git history from the inspector tab", async ({ page }) => {
  const encodedRootPath = "%2Fworkspace%2FCodexly";
  const historyRequests: string[] = [];
  const commitFileRequests: string[] = [];
  const commitDiffRequests: string[] = [];
  let releaseServerHistory: (() => void) | undefined;
  await page.route("**/v1/projects/codexly/git/history*", async (route) => {
    const url = new URL(route.request().url());
    const cursor = url.searchParams.get("cursor");
    const repository = url.searchParams.get("repository");
    historyRequests.push(url.search);
    const count = cursor === "20" ? 1 : 20;
    const start = cursor === "20" ? 20 : 0;
    if (repository === "packages/server") {
      await new Promise<void>((resolve) => {
        releaseServerHistory = resolve;
      });
    }
    await route.fulfill({
      contentType: "application/json",
      json: {
        branch: repository === "packages/server" ? "release/server" : "feat/apps-web",
        commits: Array.from({ length: count }, (_, index) => ({
          authoredAt: "2026-08-06T08:30:00+08:00",
          authorEmail: "developer@example.com",
          authorName: "Developer",
          sha: (start + index).toString(16).padStart(40, "0"),
          title: `${repository ?? "apps/web"} commit ${String(start + index + 1)}`,
        })),
        nextCursor: cursor === null && repository !== "packages/server" ? "20" : null,
        repositories: ["apps/web", "packages/server"],
        repository: repository ?? "apps/web",
        repositoryMode: "children",
      },
    });
  });
  await page.route("**/v1/projects/codexly/git/commit-files*", async (route) => {
    const url = new URL(route.request().url());
    const cursor = url.searchParams.get("cursor");
    commitFileRequests.push(url.search);
    const start = cursor === "100" ? 100 : 0;
    const count = cursor === "100" ? 1 : 100;
    await route.fulfill({
      contentType: "application/json",
      json: {
        files: Array.from({ length: count }, (_, index) => ({
          kind: index === 0 ? "update" : "create",
          path: `src/review-${String(start + index)}.ts`,
        })),
        nextCursor: cursor === null ? "100" : null,
      },
    });
  });
  await page.route("**/v1/projects/codexly/git/commit-diff*", async (route) => {
    const url = new URL(route.request().url());
    commitDiffRequests.push(url.search);
    const path = url.searchParams.get("path") ?? "src/review-0.ts";
    await route.fulfill({
      contentType: "application/json",
      json: {
        diff: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`,
        truncated: true,
      },
    });
  });
  await page.goto("/p/codexly/t/task-1");

  const branchTrigger = page.getByRole("button", { name: /切换分支，当前分支/u });
  const inspector = page.locator(".workbench-inspector");
  const historyTab = inspector.getByRole("tab", { name: "历史" });
  await expect(page.getByRole("button", { name: "查看 Git 历史" })).toHaveCount(0);
  await expect(branchTrigger.locator("svg").first()).toHaveCSS("width", "12px");
  expect(historyRequests).toEqual([]);
  await historyTab.click();

  await expect(inspector).toBeVisible();
  await expect(inspector).toHaveAttribute("aria-label", "运行环境");
  await expect(inspector.getByRole("tab", { name: "历史" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("dialog", { name: "Git 历史" })).toHaveCount(0);
  await expect(page.locator('[data-slot="sheet-content"]')).toHaveCount(0);
  await expect(inspector.getByText("当前分支：feat/apps-web")).toBeVisible();
  await expect(inspector.getByRole("listitem")).toHaveCount(20);
  await expect(inspector.getByRole("tab", { name: "apps/web" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const initialInspectorBox = await inspector.boundingBox();
  expect(historyRequests).toEqual([`?rootPath=${encodedRootPath}`]);

  await inspector.getByRole("button", { name: /^apps\/web commit 1 /u }).click();
  const reviewPanel = inspector.getByRole("tabpanel", { name: "apps/web commit 1" });
  await expect(reviewPanel).toBeVisible();
  await expect(reviewPanel.getByText("Diff 过长，仅展示前 512 KiB")).toBeVisible();
  await expect(reviewPanel.locator(".file-diff-renderer")).toContainText("new");
  expect(commitFileRequests).toEqual([
    `?repository=apps%2Fweb&rootPath=${encodedRootPath}&sha=${"0".repeat(40)}`,
  ]);
  expect(commitDiffRequests).toEqual([
    `?path=src%2Freview-0.ts&repository=apps%2Fweb&rootPath=${encodedRootPath}&sha=${"0".repeat(40)}`,
  ]);
  await reviewPanel.getByRole("button", { name: "展开变更文件导航" }).click();
  await reviewPanel.getByRole("button", { name: "加载更多文件" }).click();
  await expect(reviewPanel.getByText("review-100.ts")).toBeAttached();
  expect(commitFileRequests).toEqual([
    `?repository=apps%2Fweb&rootPath=${encodedRootPath}&sha=${"0".repeat(40)}`,
    `?cursor=100&repository=apps%2Fweb&rootPath=${encodedRootPath}&sha=${"0".repeat(40)}`,
  ]);
  expect(commitDiffRequests).toHaveLength(1);
  await reviewPanel.getByRole("button", { name: "关闭文件审核" }).click();
  await expect(reviewPanel).not.toBeAttached();
  await historyTab.click();
  await expect(inspector.getByText("apps/web commit 1", { exact: true })).toBeVisible();

  await inspector.getByRole("tab", { name: "packages/server" }).click();
  await expect(inspector.getByText("正在读取 Git 历史...")).toBeVisible();
  await expect(inspector.getByText("当前分支：读取中...")).toBeVisible();
  const pendingInspectorBox = await inspector.boundingBox();
  expect(pendingInspectorBox?.height).toBe(initialInspectorBox?.height);
  expect(pendingInspectorBox?.y).toBe(initialInspectorBox?.y);
  await expect(inspector.getByText("apps/web commit 1", { exact: true })).toBeAttached();
  await expect(inspector.getByText("apps/web commit 1", { exact: true })).toBeHidden();
  releaseServerHistory?.();
  await expect(inspector.getByText("packages/server commit 20", { exact: true })).toBeVisible();
  await expect(inspector.getByText("当前分支：release/server")).toBeVisible();
  const loadedInspectorBox = await inspector.boundingBox();
  expect(loadedInspectorBox?.height).toBe(initialInspectorBox?.height);
  expect(loadedInspectorBox?.y).toBe(initialInspectorBox?.y);
  expect(historyRequests).toEqual([
    `?rootPath=${encodedRootPath}`,
    `?repository=packages%2Fserver&rootPath=${encodedRootPath}`,
  ]);

  await inspector.getByRole("tab", { name: "apps/web" }).click();
  await expect(inspector.getByRole("listitem")).toHaveCount(20);
  await expect(inspector.getByText("当前分支：feat/apps-web")).toBeVisible();
  expect(historyRequests).toEqual([
    `?rootPath=${encodedRootPath}`,
    `?repository=packages%2Fserver&rootPath=${encodedRootPath}`,
  ]);

  await inspector.getByRole("tab", { name: "项目" }).click();
  await expect(inspector.locator('[data-slot="git-history-panel"]')).toHaveCount(0);
  await historyTab.click();
  await expect(inspector.getByRole("tab", { name: "历史" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.setViewportSize({ width: 320, height: 568 });
  await expect(inspector).not.toBeVisible();
  await page.getByRole("button", { name: "展开上下文面板" }).click();
  await expect(inspector).toBeVisible();
  expect(await inspector.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  const touchControls = [
    inspector.getByRole("button", { name: "关闭上下文面板" }),
    inspector.getByRole("tab", { name: "apps/web" }),
    inspector.getByRole("tab", { name: "packages/server" }),
    inspector.getByRole("button", { name: "加载更多" }),
  ];
  // 紧凑控件不再统一放大为 44px，但必须保持可见、可操作且不被窄屏裁切。
  for (const control of touchControls) {
    await expect(control).toBeVisible();
    await expect(control).toBeEnabled();
    await expect(control).toHaveCSS("touch-action", "manipulation");
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(24);
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
  }
  await inspector.getByRole("button", { name: "加载更多" }).click();
  await expect(inspector.getByRole("listitem")).toHaveCount(21);
  expect(historyRequests).toEqual([
    `?rootPath=${encodedRootPath}`,
    `?repository=packages%2Fserver&rootPath=${encodedRootPath}`,
    `?cursor=20&rootPath=${encodedRootPath}`,
  ]);
});

test("paginates a single repository inside the history content", async ({ page }) => {
  await page.route("**/v1/projects/codexly/git/history*", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    const start = cursor === "20" ? 20 : 0;
    const count = cursor === "20" ? 1 : 20;
    await route.fulfill({
      contentType: "application/json",
      json: {
        branch: "main",
        commits: Array.from({ length: count }, (_, index) => ({
          authoredAt: "2026-08-06T08:30:00+08:00",
          authorEmail: "developer@example.com",
          authorName: "Developer",
          sha: (start + index).toString(16).padStart(40, "0"),
          title: `root commit ${String(start + index + 1)}`,
        })),
        nextCursor: cursor === null ? "20" : null,
        repositories: [],
        repository: null,
        repositoryMode: "root",
      },
    });
  });
  await page.goto("/p/codexly/t/task-1");
  const inspector = page.locator(".workbench-inspector");
  await inspector.getByRole("tab", { name: "历史" }).click();
  const content = inspector.locator('[data-slot="git-history-content"]');
  const loadMore = content.getByRole("button", { name: "加载更多" });
  await expect(inspector.getByRole("tab", { name: "历史" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(inspector.getByRole("tab", { name: "apps/web" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Git 历史" })).toHaveCount(0);
  await expect(loadMore).toBeVisible();
  await expect(inspector.locator("footer")).toHaveCount(0);
  const loadMoreMetrics = await loadMore.evaluate((element) => {
    const container = element.parentElement;
    if (container === null) throw new Error("Load more container is unavailable");
    const containerStyle = getComputedStyle(container);
    return {
      height: element.getBoundingClientRect().height,
      parentContentWidth:
        container.clientWidth -
        Number.parseFloat(containerStyle.paddingLeft) -
        Number.parseFloat(containerStyle.paddingRight),
      width: element.getBoundingClientRect().width,
    };
  });
  expect(loadMoreMetrics.height).toBe(28);
  expect(Math.abs(loadMoreMetrics.width - loadMoreMetrics.parentContentWidth)).toBeLessThanOrEqual(
    1,
  );

  await loadMore.click();
  await expect(inspector.getByRole("listitem")).toHaveCount(21);
  await expect(content.getByText("已加载全部提交")).toBeVisible();
});
