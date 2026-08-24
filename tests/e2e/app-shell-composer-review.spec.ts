import {
  architectureSourcePreview,
  expect,
  parseRequestRecord,
  taskSnapshot,
  test,
} from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("starts code review from a new chat with one fixed review message", async ({ page }) => {
  const reviewTask = {
    id: "review-task",
    pinned: false,
    projectId: "codexly",
    title: "新聊天",
    updatedAt: "2026-07-29T00:00:00.000Z",
  };
  const reviewTurn = {
    completedAt: null,
    error: null,
    id: "review-turn",
    items: [
      {
        id: "review-mode-review-turn",
        target: { type: "uncommitted_changes" },
        type: "review",
      },
    ],
    startedAt: "2026-07-29T00:00:00.000Z",
    status: "running",
  };
  const mutationPaths: string[] = [];
  const reviewBodies: unknown[] = [];
  await page.route("**/v1/projects/codexly/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST") {
      mutationPaths.push(url.pathname);
    }
    if (url.pathname === "/v1/projects/codexly/tasks" && request.method() === "POST") {
      await route.fulfill({ contentType: "application/json", json: { task: reviewTask } });
      return;
    }
    if (
      url.pathname === "/v1/projects/codexly/tasks/review-task/review" &&
      request.method() === "POST"
    ) {
      reviewBodies.push(request.postDataJSON());
      await route.fulfill({
        contentType: "application/json",
        json: { taskId: reviewTask.id, turn: reviewTurn },
      });
      return;
    }
    if (url.pathname === "/v1/projects/codexly/tasks/review-task") {
      await route.fulfill({
        contentType: "application/json",
        json: {
          checkpoint: { sequence: 0, sessionId: "review-session" },
          snapshot: {
            ...reviewTask,
            contextUsage: null,
            pendingRequests: [],
            plan: null,
            settings: taskSnapshot.settings,
            status: "running",
            turns: [reviewTurn],
            turnsNextCursor: null,
          },
        },
      });
      return;
    }
    await route.fallback();
  });
  await page.goto("/p/codexly");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.fill("/");
  await page.getByRole("option", { name: /代码审查/u }).click();
  await expect(page.getByRole("group", { name: "选择审查范围" })).toBeVisible();
  await expect(page.getByRole("option", { name: /审查未提交的更改/u })).toBeVisible();
  await expect(page.getByRole("option", { name: /基于基础分支进行审查/u })).toContainText(
    "origin/main",
  );
  expect(mutationPaths).toEqual([]);
  await prompt.fill("重新选择 /初始化");
  await expect(page.getByRole("group", { name: "选择审查范围" })).toBeHidden();
  await expect(page.getByRole("option", { name: /初始化/u })).toBeVisible();
  await prompt.fill("/");
  await page.getByRole("option", { name: /代码审查/u }).click();
  await page.getByRole("option", { name: /审查未提交的更改/u }).click();

  await expect(page).toHaveURL(/\/p\/codexly\/t\/review-task$/u);
  await expect(page.getByText("请检查我未提交的更改", { exact: true })).toHaveCount(1);
  await expect(page.getByText("审查模式", { exact: true })).toBeVisible();
  await expect(page.getByText(/Review the current code changes/u)).toHaveCount(0);
  await expect
    .poll(() => mutationPaths)
    .toEqual(["/v1/projects/codexly/tasks", "/v1/projects/codexly/tasks/review-task/review"]);
  expect(reviewBodies).toEqual([{ target: { type: "uncommitted_changes" } }]);
});

test("selects a real base branch before starting code review", async ({ page }) => {
  const reviewBodies: unknown[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/v1/projects/codexly/tasks/task-1/review"
    ) {
      reviewBodies.push(request.postDataJSON());
    }
  });
  await page.goto("/p/codexly/t/task-1");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.fill("/代码审查");
  await prompt.press("Enter");
  await prompt.press("ArrowDown");
  await prompt.press("Enter");

  const branchGroup = page.getByRole("group", { name: "选择基础分支" });
  await expect(branchGroup).toBeVisible();
  await expect(branchGroup.getByRole("option")).toHaveCount(3);
  await branchGroup.getByRole("option", { name: "release" }).click();

  await expect
    .poll(() => reviewBodies)
    .toEqual([{ target: { branch: "release", type: "base_branch" } }]);
});

test("loads long source files while scrolling", async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/p/codexly/t/task-1");

  const sourceReference = page.getByRole("button", {
    name: /architecture-design\.md\s+\(line 100\)/u,
  });
  await sourceReference.click();

  const inspector = page.getByRole("complementary", { name: "运行环境" });
  const filePanel = inspector.getByRole("region", { name: "docs/architecture-design.md" });
  await expect(inspector.getByRole("tab", { name: "文件" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(filePanel).toBeVisible();
  const sourcePathLabel = filePanel.getByText("docs/architecture-design.md", { exact: true });
  await expect(sourcePathLabel).toHaveCSS("overflow", "hidden");
  await expect(sourcePathLabel).toHaveCSS("text-overflow", "ellipsis");
  await sourcePathLabel.hover();
  await expect(page.getByRole("tooltip")).toHaveText("docs/architecture-design.md");
  await expect(filePanel.getByText("部分内容")).toBeVisible();
  await expect(filePanel.locator('[data-language="markdown"]')).toBeVisible();
  const highlightedLine = filePanel.locator('[data-code-line="100"]');
  await expect(highlightedLine).toContainText("### 11.7 外部登录边界");
  await expect(highlightedLine).toHaveAttribute("data-highlighted", "true");
  await expect(highlightedLine).toBeInViewport();

  await filePanel.locator('[data-code-line="720"]').scrollIntoViewIfNeeded();
  await expect(filePanel.locator('[data-code-line="800"]')).toContainText("line 800");
  await expect(filePanel.getByText("部分内容")).toBeHidden();

  await filePanel.getByRole("button", { name: "预览 Markdown" }).click();
  await expect(filePanel.getByRole("heading", { name: "11.7 外部登录边界" })).toBeVisible();
  await expect(filePanel.locator('[data-language="markdown"]')).not.toBeAttached();

  await filePanel.getByRole("button", { name: "显示原始内容" }).click();
  await expect(filePanel.locator('[data-language="markdown"]')).toBeVisible();

  await filePanel.getByRole("button", { name: "复制代码" }).click();
  await expect(filePanel.getByRole("button", { name: "代码已复制" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const clipboardText = await navigator.clipboard.readText();
        // Windows 剪贴板会把多行文本规范化为 CRLF，比较前统一为 LF。
        return clipboardText.replace(/\r\n?/gu, "\n");
      }),
    )
    .toBe(architectureSourcePreview);

  await inspector.getByRole("button", { name: "关闭文件" }).click();
  await expect(filePanel).not.toBeAttached();
  await expect(inspector.getByRole("tab", { name: "文件" })).toHaveCount(0);
});

test("routes assistant links, images, and system files by Markdown file rules", async ({
  page,
}) => {
  const systemOpenRequest = page.waitForRequest((request) => {
    if (new URL(request.url()).pathname !== "/v1/projects/codexly/open") {
      return false;
    }
    const body = parseRequestRecord(request.postData());
    return (
      body["appId"] === "system-default" &&
      body["path"] === "/home/taoye/100%完成/AI 领航/后续工作交接.pptx"
    );
  });
  await page.goto("/p/codexly/t/task-1");

  const externalLink = page.getByRole("link", { name: "OpenAI" });
  await expect(externalLink).toHaveAttribute("target", "_blank");
  await expect(externalLink).toHaveAttribute("rel", "noopener noreferrer");

  await page.getByRole("button", { name: "result.png" }).click();
  const inspector = page.getByRole("complementary", { name: "运行环境" });
  const imagePanel = inspector.getByRole("region", {
    name: "/workspace/Codexly/design/result.png",
  });
  await expect(imagePanel).toBeVisible();
  await expect(imagePanel.getByRole("img", { name: "result.png" })).toHaveAttribute(
    "src",
    "/v1/projects/codexly/files/image?path=%2Fworkspace%2FCodexly%2Fdesign%2Fresult.png&rootPath=%2Fworkspace%2FCodexly",
  );

  await page.getByRole("button", { name: /architecture-design\.md\s+\(line 100\)/u }).click();
  await expect(imagePanel).not.toBeAttached();
  await expect(
    inspector.getByRole("region", { name: "docs/architecture-design.md" }),
  ).toBeVisible();
  const fileTab = inspector.getByRole("tab", { name: "文件" });
  const closeFileButton = inspector.getByRole("button", { name: "关闭文件" });
  await expect(fileTab).toHaveCount(1);
  const fileTabBox = await fileTab.boundingBox();
  const closeFileButtonBox = await closeFileButton.boundingBox();
  // 关闭入口必须完整落在文件标签表面内，防止再次退回标签外的并列布局。
  expect(fileTabBox).not.toBeNull();
  expect(closeFileButtonBox).not.toBeNull();
  if (fileTabBox === null || closeFileButtonBox === null) {
    throw new Error("File tab geometry is unavailable");
  }
  expect(closeFileButtonBox.x).toBeGreaterThanOrEqual(fileTabBox.x);
  expect(closeFileButtonBox.width).toBeLessThanOrEqual(16);
  expect(closeFileButtonBox.x + closeFileButtonBox.width).toBeLessThanOrEqual(
    fileTabBox.x + fileTabBox.width,
  );
  await closeFileButton.click();

  await page.getByRole("button", { exact: true, name: "后续工作交接.pptx" }).click();
  await systemOpenRequest;
  await expect(page.getByRole("dialog", { name: "后续工作交接.pptx" })).toHaveCount(0);
  await expect(inspector.getByRole("tab", { name: "文件" })).toHaveCount(0);
});

test("project file tree opens changed, source, image, and system files by shared rules", async ({
  page,
}) => {
  await page.goto("/p/codexly/t/task-1");

  const inspector = page.getByRole("complementary", { name: "运行环境" });
  await inspector.getByRole("tab", { name: "项目" }).click();
  const fileTree = inspector.getByRole("tree", { name: "项目文件" });
  await expect(fileTree).toBeVisible();
  await expect(fileTree.getByRole("treeitem", { name: "architecture-design.md" })).toHaveCount(0);

  const packageFile = fileTree.getByRole("treeitem", { name: /package\.json/u });
  await expect(packageFile).toHaveCSS("cursor", "default");
  await packageFile.click();
  const diffPanel = inspector.getByRole("region", { name: "package.json" });
  await expect(diffPanel.locator(".file-diff-renderer")).toContainText("pnpm run dev");
  await expect(page.getByRole("dialog", { name: "package.json" })).toHaveCount(0);
  await inspector.getByRole("button", { name: "关闭文件" }).click();

  const docsRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === "/v1/projects/codexly/files/tree" && url.searchParams.get("path") === "docs"
    );
  });
  const docsDirectory = fileTree.getByRole("treeitem", { name: "docs" });
  await expect(docsDirectory).toHaveCSS("cursor", "default");
  await docsDirectory.click();
  await docsRequest;
  await fileTree.getByRole("treeitem", { name: "architecture-design.md" }).click();
  const sourcePanel = inspector.getByRole("region", { name: "docs/architecture-design.md" });
  await expect(sourcePanel).toBeVisible();
  await inspector.getByRole("button", { name: "关闭文件" }).click();
  await expect(sourcePanel).not.toBeAttached();

  const imageRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === "/v1/projects/codexly/files/image" &&
      url.searchParams.get("path") === "design/result.png"
    );
  });
  await fileTree.getByRole("button", { name: "展开文件夹 design" }).click();
  await fileTree.getByRole("treeitem", { name: "result.png" }).click();
  await imageRequest;
  const imagePanel = inspector.getByRole("region", { name: "design/result.png" });
  await expect(imagePanel.getByRole("img", { name: "result.png" })).toBeVisible();
  await inspector.getByRole("button", { name: "关闭文件" }).click();
  await expect(imagePanel).not.toBeAttached();

  const systemOpenRequest = page.waitForRequest((request) => {
    if (new URL(request.url()).pathname !== "/v1/projects/codexly/open") {
      return false;
    }
    const body = parseRequestRecord(request.postData());
    return body["appId"] === "system-default" && body["path"] === "100%完成 后续工作交接.pptx";
  });
  await fileTree.getByRole("treeitem", { name: "100%完成 后续工作交接.pptx" }).click();
  await systemOpenRequest;
  await expect(page.getByRole("dialog", { name: "100%完成 后续工作交接.pptx" })).toHaveCount(0);
});

test("project file tree virtualizes 10,000 files and keeps keyboard navigation usable", async ({
  page,
}) => {
  await page.route("**/v1/projects/codexly/files/tree*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        entries: Array.from({ length: 10_000 }, (_, index) => ({
          path: `file-${String(index).padStart(5, "0")}.ts`,
          type: "file",
        })),
        path: null,
      },
    });
  });
  await page.goto("/p/codexly/t/task-1");

  const inspector = page.getByRole("complementary", { name: "运行环境" });
  await inspector.getByRole("tab", { name: "项目" }).click();
  const fileTree = inspector.getByRole("tree", { name: "项目文件" });
  const root = fileTree.getByRole("treeitem", { name: "Codexly" });
  await expect(root).toHaveAttribute("aria-expanded", "true");
  await expect(fileTree.getByRole("treeitem", { name: "file-00000.ts" })).toBeVisible();
  expect(await fileTree.getByRole("treeitem").count()).toBeLessThanOrEqual(40);

  await root.focus();
  await root.press("End");
  await expect(fileTree.getByRole("treeitem", { name: "file-09999.ts" })).toBeFocused();
  expect(await fileTree.getByRole("treeitem").count()).toBeLessThanOrEqual(40);
});
