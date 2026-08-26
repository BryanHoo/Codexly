import { expect, taskSnapshot, taskSnapshotResponse, test } from "./fixtures/app-shell.js";
import {
  getComposerModelSelector,
  selectComposerModel,
  selectComposerReasoning,
} from "./app-shell-settings-navigation.test-support.js";

test.describe.configure({ mode: "serial" });

test("renders the AI workbench landmarks with an enabled composer", async ({ page }) => {
  await page.goto("/p/codexly/t/task-1");

  const main = page.getByRole("main", { name: "任务时间线" });
  const inspector = page.getByRole("complementary", { name: "运行环境" });
  await expect(page.getByRole("complementary", { name: "项目侧栏" })).toBeVisible();
  await expect(main).toBeVisible();
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole("heading", { name: "运行环境" })).toHaveCount(0);
  await expect(inspector.getByRole("tab", { name: "项目" })).toBeVisible();
  await expect(inspector.getByRole("tab", { name: "上下文" })).toBeVisible();
  await expect(page.getByRole("region", { name: "消息编辑器" })).toBeVisible();
  const prompt = page.getByRole("textbox", { name: "任务输入" });
  const approvalSelect = page.getByRole("combobox", { name: "批准模式" });
  const modelSelector = getComposerModelSelector(page);
  await expect(prompt).toBeEnabled();
  await expect(approvalSelect).toHaveValue("on-request");
  await expect(approvalSelect).toHaveCSS("appearance", "none");
  await expect
    .poll(() => approvalSelect.evaluate((element) => getComputedStyle(element).fieldSizing))
    .toBe("content");
  await expect(modelSelector).toHaveAttribute("data-slot", "composer-model-selector");
  await expect(modelSelector).toHaveAccessibleName("模型和思考量：GPT-5.6 Sol，高");
  const composerForm = page.getByRole("region", { name: "消息编辑器" }).locator("form");
  const composerControls = [
    prompt,
    page.getByRole("button", { name: "添加图片或文件" }),
    approvalSelect,
    modelSelector,
  ];
  for (const control of composerControls) {
    await control.focus();
    // 内部控件不重复绘制主色焦点框，焦点状态统一由 Composer 外框表达。
    await expect(control).toHaveCSS("outline-style", "none");
    await expect(composerForm).toHaveCSS("border-color", "rgb(0, 106, 255)");
  }
  await expect(page.getByText("本地", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { exact: true, name: "提交" })).toBeDisabled();
  await prompt.fill("继续当前任务");
  await expect(page.getByRole("button", { exact: true, name: "提交" })).toBeEnabled();
  await expect(main.locator("header").getByText("Codexly", { exact: true })).toHaveCount(0);
  await expect(page.getByText("本地离线", { exact: true })).toHaveCount(0);
  const projectPathButton = page.getByRole("button", { name: "在系统文件夹中打开" });
  await expect(projectPathButton).toHaveText("/workspace/Codexly");
  const projectPathSizing = await projectPathButton.evaluate((element) => ({
    buttonWidth: element.getBoundingClientRect().width,
    footerWidth: element.parentElement?.getBoundingClientRect().width ?? 0,
  }));
  expect(projectPathSizing.buttonWidth / projectPathSizing.footerWidth).toBeLessThan(0.51);
  await expect(projectPathButton).toHaveCSS("height", "24px");
  await expect(projectPathButton).toHaveCSS("font-size", "10px");
  const projectPathIcon = projectPathButton.locator("svg");
  await expect(projectPathIcon).toHaveCSS("height", "12px");
  await expect(projectPathIcon).toHaveCSS("width", "12px");
  const restingProjectPathBackground = await projectPathButton.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await projectPathButton.hover();
  await expect
    .poll(() => projectPathButton.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(restingProjectPathBackground);
  await expect(page.getByRole("tooltip")).toHaveText("在系统文件夹中打开");
  const openProjectRequest = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/v1/projects/codexly/open" &&
      request.method() === "POST",
  );
  await projectPathButton.click();
  expect((await openProjectRequest).postDataJSON()).toEqual({ appId: "finder" });
  const contextUsageButton = page.getByRole("button", { name: "上下文已使用 13%" });
  await expect(contextUsageButton).toBeVisible();
  const contextUsagePercentage = contextUsageButton.getByText("13%", { exact: true });
  const contextUsageRing = contextUsageButton.locator("svg");
  await expect(contextUsagePercentage).toBeVisible();
  await expect(contextUsageRing.locator("circle")).toHaveCount(2);
  expect(
    await contextUsagePercentage.evaluate((element) => element.getBoundingClientRect().right),
  ).toBeLessThanOrEqual(
    await contextUsageRing.evaluate((element) => element.getBoundingClientRect().left),
  );
  await expect(contextUsageButton).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await contextUsageButton.hover();
  const contextUsageTooltip = page.getByRole("tooltip");
  await expect(contextUsageTooltip).toContainText("13% 上下文已使用");
  await expect(contextUsageTooltip).toContainText("25K / 200K tokens");
  await expect(inspector.getByRole("button", { name: "关闭上下文面板" })).toBeHidden();
  await expect(page.getByText("工作台界面已按统一的 项目 Agent 组件 结构重新组织。")).toBeVisible();
});

test("renders task-readable MCP servers and sources in inspector", async ({ page }) => {
  const contextSkills = Array.from({ length: 6 }, (_, index) => ({
    description: `Skill description ${String(index + 1)}`,
    displayName: `Skill ${String(index + 1)}`,
    id: `skill-${String(index + 1)}`,
    name: `skill-${String(index + 1)}`,
    scope: "system",
  }));
  await page.route("**/v1/projects/codexly/skills", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { data: contextSkills, nextCursor: null },
    });
  });
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshotResponse.snapshot,
          turns: taskSnapshot.turns.map((turn) => ({
            ...turn,
            items: turn.items.map((item) =>
              item.id === "message-1"
                ? {
                    ...item,
                    skills: contextSkills.map((skill) => ({ name: skill.name })),
                  }
                : item,
            ),
          })),
        },
      },
    });
  });
  await page.route("**/v1/projects/codexly/tasks/task-1/mcp-servers", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        data: Array.from({ length: 6 }, (_, index) => ({
          authStatus: "unsupported",
          description: null,
          error: null,
          failureReason: null,
          name: `mcp-tool-${String(index + 1)}`,
          status: "ready",
          title: `MCP Tool ${String(index + 1)}`,
          toolCount: 2,
          version: "1.0.0",
        })),
      },
    });
  });
  await page.goto("/p/codexly/t/task-1");

  const inspector = page.getByRole("complementary", { name: "运行环境" });
  await inspector.getByRole("tab", { name: "上下文" }).click();
  const mcp = inspector.getByRole("region", { name: "MCP" });
  const sources = inspector.getByRole("region", { name: "来源" });

  await expect(mcp.getByText("MCP Tool 5", { exact: true })).toBeVisible();
  await expect(mcp.getByText("MCP Tool 6", { exact: true })).toHaveCount(0);
  const firstMcpRow = mcp.getByLabel("mcp-tool-1");
  const restingMcpBackground = await firstMcpRow.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await firstMcpRow.hover();
  await expect(page.getByRole("tooltip")).toHaveText("mcp-tool-1");
  await expect
    .poll(() => firstMcpRow.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(restingMcpBackground);
  await mcp.getByRole("button", { name: "显示更多" }).click();
  await expect(mcp.getByText("MCP Tool 6", { exact: true })).toBeVisible();
  await expect(inspector.getByRole("region", { name: "环境" })).toHaveCount(0);
  await expect(inspector.getByText("gpt-5.6-sol", { exact: true })).toHaveCount(0);
  await expect(inspector.getByText("工作区可写", { exact: true })).toHaveCount(0);
  await expect(inspector.getByText("feat/review-targets", { exact: true })).toHaveCount(0);
  await expect(sources.getByText("Skill 5", { exact: true })).toBeVisible();
  await expect(sources.getByText("Skill 6", { exact: true })).toHaveCount(0);
  await sources.getByText("Skill 1", { exact: true }).hover();
  await expect(page.getByRole("tooltip")).toHaveText("Skill description 1");
  await sources.getByRole("button", { name: "显示更多" }).click();
  await expect(sources.getByText("Skill 6", { exact: true })).toBeVisible();
  await expect(sources.getByText("项目目录", { exact: true })).toHaveCount(0);
  await expect(inspector.getByText("This Mac", { exact: true })).toHaveCount(0);
  await expect(inspector.getByText("项目 Agent 组件", { exact: true })).toHaveCount(0);
  await expect(inspector.getByRole("button", { name: "添加来源" })).toHaveCount(0);
  await inspector.getByRole("button", { name: "查看 1 个未提交变更" }).click();
  await expect(inspector.getByRole("tab", { name: "变更" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("opens message images in a preview dialog @cross-browser", async ({ context, page }) => {
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshotResponse.snapshot,
          turns: taskSnapshot.turns.map((turn) => ({
            ...turn,
            items: turn.items.map((item) =>
              item.id === "message-1"
                ? {
                    ...item,
                    attachments: [
                      {
                        id: "history/image-1",
                        kind: "image",
                        mediaType: "image/png",
                        name: "diagram.png",
                        size: 68,
                      },
                    ],
                    skills: [],
                    text: "阅读并理解项目",
                  }
                : item,
            ),
          })),
        },
      },
    });
  });
  await page.route("**/attachments/history%2Fimage-1", async (route) => {
    await route.fulfill({
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
      contentType: "image/png",
    });
  });
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/p/codexly/t/task-1");

  const userMessage = page.locator('article[data-role="user"]').first();
  const attachment = userMessage.locator('[data-message-attachment="image"]');
  const textBubble = userMessage.locator('[data-message-text="true"]');
  await expect(attachment).toBeVisible();
  await expect(attachment).toHaveCSS("border-radius", "8px");
  await expect(attachment).toHaveCSS("height", "160px");
  await expect(attachment).toHaveCSS("width", "160px");
  await expect(userMessage.getByText("diagram.png", { exact: true })).toHaveCount(0);

  const attachmentBounds = await attachment.boundingBox();
  const textBounds = await textBubble.boundingBox();
  expect(attachmentBounds).not.toBeNull();
  expect(textBounds).not.toBeNull();
  expect(attachmentBounds?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(textBounds?.y ?? 0);
  expect((attachmentBounds?.x ?? 0) + (attachmentBounds?.width ?? 0)).toBeLessThanOrEqual(390);

  await attachment.click();
  const imagePreview = page.getByRole("dialog", { name: "diagram.png" });
  await expect(imagePreview).toBeVisible();
  expect(context.pages()).toHaveLength(1);
  await imagePreview.getByRole("button", { name: "关闭图片预览" }).click();
  await expect(imagePreview).toHaveCount(0);
});

test("keeps Projects fixed and manages task actions from the compact tree", async ({ page }) => {
  await page.goto("/p/codexly/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  const projectsHeading = sidebar.getByRole("heading", { name: "项目" });
  const pinnedHeading = sidebar.getByRole("heading", { name: "已固定" });
  const projectTree = page.getByTestId("project-tree-scroll");
  const projectGroup = sidebar
    .getByRole("button", { name: "切换项目 Codexly" })
    .locator("xpath=../..");

  await expect(projectsHeading).toBeVisible();
  await expect
    .poll(async () =>
      Number.parseFloat(await projectsHeading.evaluate((node) => getComputedStyle(node).fontSize)),
    )
    .toBeGreaterThan(
      Number.parseFloat(await pinnedHeading.evaluate((node) => getComputedStyle(node).fontSize)),
    );
  const headingY = (await projectsHeading.boundingBox())?.y;
  await projectTree.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect((await projectsHeading.boundingBox())?.y).toBe(headingY);

  await expect(projectGroup.getByRole("link")).toHaveCount(5);
  const showMoreButton = projectGroup.getByRole("button", { name: "显示更多" });
  const showMoreBox = await showMoreButton.boundingBox();
  const taskListBox = await showMoreButton.locator("xpath=..").boundingBox();
  expect(showMoreBox).not.toBeNull();
  expect(taskListBox).not.toBeNull();
  if (showMoreBox === null || taskListBox === null) {
    throw new Error("项目任务展开按钮缺失");
  }
  expect
    .soft(Math.abs(showMoreBox.x + showMoreBox.width - (taskListBox.x + taskListBox.width)))
    .toBeLessThanOrEqual(1);
  await showMoreButton.click();
  await expect(projectGroup.getByRole("link")).toHaveCount(7);

  const inputTask = projectGroup.getByRole("link", { name: /优化输入框交互/u });
  const inputTaskBox = await inputTask.boundingBox();
  const inputTaskAgeBox = await inputTask.locator(".task-age").boundingBox();
  expect(inputTaskBox).not.toBeNull();
  expect(inputTaskAgeBox).not.toBeNull();
  if (inputTaskBox === null || inputTaskAgeBox === null) {
    throw new Error("Task 时间布局缺失");
  }
  expect
    .soft(
      Math.abs(inputTaskBox.x + inputTaskBox.width - (inputTaskAgeBox.x + inputTaskAgeBox.width)),
    )
    .toBeLessThanOrEqual(10);
  await inputTask.hover();
  await projectGroup.getByRole("button", { name: "打开 优化输入框交互 的操作菜单" }).click();
  await page.getByRole("menuitem", { name: "固定" }).click();
  const pinnedSection = pinnedHeading.locator("xpath=..");
  const pinnedInputTask = pinnedSection.getByRole("link", { name: /优化输入框交互/u });
  await expect(pinnedInputTask).toBeVisible();
  await pinnedInputTask.hover();
  const pinnedMenuTrigger = pinnedSection.getByRole("button", {
    name: "打开 优化输入框交互 的操作菜单",
  });
  await pinnedMenuTrigger.click();
  const pinnedMenu = page.getByRole("menu", { name: "优化输入框交互 的任务操作" });
  await expect(pinnedMenu).toBeVisible();
  const pinnedMenuTriggerBox = await pinnedMenuTrigger.boundingBox();
  const pinnedMenuBox = await pinnedMenu.boundingBox();
  expect(pinnedMenuTriggerBox).not.toBeNull();
  expect(pinnedMenuBox).not.toBeNull();
  if (pinnedMenuTriggerBox === null || pinnedMenuBox === null) {
    throw new Error("Pinned Task 菜单布局缺失");
  }
  expect.soft(Math.abs(pinnedMenuBox.x - pinnedMenuTriggerBox.x)).toBeLessThanOrEqual(1);
  await pinnedMenu.getByRole("menuitem", { name: "重命名" }).click();
  await page.getByRole("textbox", { name: "任务名称" }).fill("优化侧栏任务操作");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(projectGroup.getByText("优化侧栏任务操作", { exact: true })).toBeVisible();

  const activeTask = projectGroup.getByRole("link", { name: /构建 macOS 工作台/u });
  await activeTask.hover();
  await projectGroup.getByRole("button", { name: "打开 构建 macOS 工作台 的操作菜单" }).click();
  await page.getByRole("menuitem", { name: "归档" }).click();
  await expect(page).toHaveURL(/\/p\/codexly$/u);
  await expect(projectGroup.getByText("构建 macOS 工作台", { exact: true })).toHaveCount(0);
});

test("permanently deletes the active task only after confirmation", async ({ page }) => {
  let deleteRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() === "DELETE" &&
      new URL(request.url()).pathname === "/v1/projects/codexly/tasks/task-1"
    ) {
      deleteRequests += 1;
    }
  });
  await page.goto("/p/codexly/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  const projectGroup = sidebar
    .getByRole("button", { name: "切换项目 Codexly" })
    .locator("xpath=../..");
  const activeTask = projectGroup.getByRole("link", { name: /构建 macOS 工作台/u });
  await activeTask.hover();
  await projectGroup.getByRole("button", { name: "打开 构建 macOS 工作台 的操作菜单" }).click();
  await page.getByRole("menuitem", { name: "永久删除" }).click();

  const confirmation = page.getByRole("dialog", { name: "永久删除任务" });
  await expect(confirmation).toContainText("构建 macOS 工作台");
  expect(deleteRequests).toBe(0);
  await confirmation.getByRole("button", { name: "永久删除" }).click();

  await expect(page).toHaveURL(/\/p\/codexly$/u);
  await expect(projectGroup.getByText("构建 macOS 工作台", { exact: true })).toHaveCount(0);
  expect(deleteRequests).toBe(1);
});

test("renames the active task from the center title", async ({ page }) => {
  await page.goto("/p/codexly/t/task-1");

  const main = page.getByRole("main", { name: "任务时间线" });
  await main.getByRole("button", { name: "重命名任务 构建 macOS 工作台" }).click();

  const dialog = page.getByRole("dialog", { name: "重命名任务" });
  await dialog.getByRole("textbox", { name: "任务名称" }).fill("重命名中栏任务");
  await dialog.getByRole("button", { name: "保存" }).click();

  await expect(main.getByRole("heading", { name: "重命名中栏任务" })).toBeVisible();
  await expect(
    page
      .getByRole("complementary", { name: "项目侧栏" })
      .getByRole("link", { name: /重命名中栏任务/u }),
  ).toHaveCount(2);
});

test("restores task settings after a page refresh", async ({ page }) => {
  await page.goto("/p/codexly/t/task-1");

  const approvalSelect = page.getByRole("combobox", { name: "批准模式" });
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith("/tasks/task-1/settings") && response.ok(),
    ),
    selectComposerModel(page, "GPT-5.6 Terra"),
  ]);
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith("/tasks/task-1/settings") && response.ok(),
    ),
    selectComposerReasoning(page, "低"),
  ]);
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith("/tasks/task-1/settings") && response.ok(),
    ),
    approvalSelect.selectOption("auto-review"),
  ]);

  await page.reload();

  await expect(getComposerModelSelector(page)).toHaveAccessibleName(
    "模型和思考量：GPT-5.6 Terra，低",
  );
  await expect(page.getByRole("combobox", { name: "批准模式" })).toHaveValue("auto-review");
});

test("restores the project's complete last task configuration", async ({ page }) => {
  await page.goto("/p/codexly");

  const approvalSelect = page.getByRole("combobox", { name: "批准模式" });
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/defaults") && response.ok()),
    selectComposerModel(page, "GPT-5.6 Terra"),
  ]);
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/defaults") && response.ok()),
    selectComposerReasoning(page, "低"),
  ]);
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/defaults") && response.ok()),
    approvalSelect.selectOption("never"),
  ]);

  await page.reload();

  await expect(getComposerModelSelector(page)).toHaveAccessibleName(
    "模型和思考量：GPT-5.6 Terra，低",
  );
  await expect(page.getByRole("combobox", { name: "批准模式" })).toHaveValue("never");
});
