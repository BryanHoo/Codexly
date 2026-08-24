import { expect, tasks, test } from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("loads one project task page only after showing more", async ({ page }) => {
  // 隔离并行用例的实时广播，只验证用户触发的 Cursor 分页请求。
  await page.routeWebSocket("**/v1/projects/codexly/events?*", () => undefined);
  const taskListRequests: URL[] = [];
  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    if (
      requestUrl.pathname === "/v1/projects/codexly/tasks" &&
      requestUrl.searchParams.get("pinned") !== "true"
    ) {
      taskListRequests.push(requestUrl);
    }
  });

  await page.goto("/p/codexly/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  await expect.poll(() => taskListRequests.length).toBe(1);
  expect(taskListRequests[0]?.searchParams.get("limit")).toBe("5");
  expect(taskListRequests[0]?.searchParams.has("cursor")).toBe(false);
  await expect(sidebar.getByRole("link", { name: "优化 Client 请求" })).toHaveCount(0);

  await sidebar.getByRole("button", { name: "显示更多" }).click();

  await expect.poll(() => taskListRequests.length).toBe(2);
  expect(taskListRequests[1]?.searchParams.get("cursor")).toBe("5");
  expect(taskListRequests[1]?.searchParams.get("limit")).toBe("5");
  await expect(sidebar.getByRole("link", { name: "优化 Client 请求" })).toBeVisible();
});

test("keeps project add buttons visible after opening a task", async ({ page }) => {
  const longTask = {
    ...tasks[1],
    title: "这是一个用于验证项目树横向布局不会挤走右侧操作按钮的超长任务名称",
  };
  await page.route("**/v1/projects/codexly/tasks?*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { data: [longTask, ...tasks.slice(2, 7)], nextCursor: null },
    });
  });
  await page.goto("/p/codexly/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  await sidebar.getByRole("link", { name: longTask.title }).click();

  const layout = await sidebar.evaluate((element) => {
    const sidebarRect = element.getBoundingClientRect();
    const projectTree = element.querySelector<HTMLElement>('[data-testid="project-tree-scroll"]');
    const addButtons = [
      ...element.querySelectorAll<HTMLElement>(
        'button[aria-label*="添加项目"], button[aria-label^="在 "]',
      ),
    ];
    return {
      addButtonsInsideSidebar: addButtons.every((button) => {
        const rect = button.getBoundingClientRect();
        return rect.left >= sidebarRect.left && rect.right <= sidebarRect.right;
      }),
      hasHorizontalOverflow:
        projectTree === null ? true : projectTree.scrollWidth > projectTree.clientWidth,
      sidebarWidth: sidebarRect.width,
    };
  });

  expect(layout).toEqual({
    addButtonsInsideSidebar: true,
    hasHorizontalOverflow: false,
    sidebarWidth: 288,
  });
  await expect(sidebar.getByRole("button", { name: "添加项目" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "在 Codexly 中新建任务" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "在 superwork 中新建任务" })).toBeVisible();
});

test("preserves provisional IME text across composer rerenders @cross-browser", async ({
  page,
}) => {
  await page.goto("/p/codexly/t/task-1");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.focus();
  await prompt.dispatchEvent("compositionstart");
  await prompt.evaluate((editor) => {
    if (!(editor instanceof HTMLDivElement) || editor.contentEditable !== "true") {
      throw new Error("任务输入不是可编辑区域");
    }
    // 中文输入法首键先写入组合缓冲，此时还不会触发 React onChange。
    editor.textContent = "n";
    editor.dispatchEvent(new CompositionEvent("compositionupdate", { data: "n" }));
  });

  await page.getByRole("combobox", { name: "批准模式" }).evaluate((select) => {
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error("批准模式不是 select");
    }
    select.value = "never";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await expect(prompt).toHaveText("n");
});

test("uses material hierarchy instead of strong workbench borders", async ({ page }) => {
  await page.goto("/p/codexly/t/task-1");
  await expect(page.locator('[role="log"] > div')).toBeVisible();

  const presentation = await page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>('[aria-label="项目侧栏"]');
    const inspector = document.querySelector<HTMLElement>('[aria-label="运行环境"]');
    const timeline = document.querySelector<HTMLElement>('[aria-label="任务时间线"]');
    const sidebarToolbar = sidebar?.querySelector<HTMLElement>(":scope > div") ?? null;
    const inspectorToolbar = inspector?.querySelector<HTMLElement>(":scope > div") ?? null;
    const toolbar = timeline?.querySelector<HTMLElement>("header") ?? null;
    const timelineContent = document.querySelector<HTMLElement>('[role="log"] > div');
    const composerRegion = document.querySelector<HTMLElement>('[aria-label="消息编辑器"]');
    const composer = document.querySelector<HTMLElement>('[aria-label="消息编辑器"] form');

    if (
      sidebar === null ||
      inspector === null ||
      timeline === null ||
      sidebarToolbar === null ||
      inspectorToolbar === null ||
      toolbar === null ||
      timelineContent === null ||
      composerRegion === null ||
      composer === null
    ) {
      throw new Error("workbench surfaces are missing");
    }

    const composerRegionStyles = getComputedStyle(composerRegion);
    const sidebarStyles = getComputedStyle(sidebar);
    const sidebarToolbarStyles = getComputedStyle(sidebarToolbar);
    const inspectorStyles = getComputedStyle(inspector);
    const inspectorToolbarStyles = getComputedStyle(inspectorToolbar);
    const timelineStyles = getComputedStyle(timeline);
    const timelineContentStyles = getComputedStyle(timelineContent);
    const toolbarStyles = getComputedStyle(toolbar);
    const composerStyles = getComputedStyle(composer);
    // 将布局断言绑定到语义 Token，避免 Toolbar 尺寸调整后测试保留旧字面值。
    const workbenchHeaderProbe = document.createElement("div");
    workbenchHeaderProbe.style.height = "var(--ui-layout-workbench-header-height)";
    document.body.append(workbenchHeaderProbe);
    const workbenchHeaderHeight = getComputedStyle(workbenchHeaderProbe).height;
    workbenchHeaderProbe.remove();

    return {
      composerBorder: composerStyles.borderTopWidth,
      composerBorderColor: composerStyles.borderTopColor,
      composerBottomPadding: Number.parseFloat(composerRegionStyles.paddingBottom),
      composerShadow: composerStyles.boxShadow,
      inspectorBorder: inspectorStyles.borderLeftWidth,
      inspectorColor: inspectorStyles.backgroundColor,
      inspectorShadow: inspectorStyles.boxShadow,
      inspectorToolbarShadow: inspectorToolbarStyles.boxShadow,
      sidebarBorder: sidebarStyles.borderRightWidth,
      sidebarColor: sidebarStyles.backgroundColor,
      sidebarShadow: sidebarStyles.boxShadow,
      sidebarToolbarShadow: sidebarToolbarStyles.boxShadow,
      timelineColor: timelineStyles.backgroundColor,
      timelineTopPadding: Number.parseFloat(timelineContentStyles.paddingTop),
      toolbarHeight: toolbarStyles.height,
      toolbarShadow: toolbarStyles.boxShadow,
      workbenchHeaderHeight,
    };
  });

  expect(presentation.sidebarBorder).toBe("0px");
  expect(presentation.inspectorBorder).toBe("0px");
  expect(presentation.composerBorder).toBe("1px");
  expect(presentation.composerBorderColor).toBe("rgba(0, 0, 0, 0)");
  expect(presentation.sidebarShadow).toContain("1px 0px 0px 0px");
  expect(presentation.inspectorShadow).toContain("-1px 0px 0px 0px");
  expect(presentation.sidebarToolbarShadow).toBe("none");
  expect(presentation.inspectorToolbarShadow).toBe("none");
  expect(presentation.toolbarShadow).toContain("0px 1px 0px 0px");
  expect(presentation.composerShadow).not.toBe("none");
  expect(presentation.sidebarColor).toBe(presentation.timelineColor);
  expect(presentation.inspectorColor).toBe(presentation.timelineColor);
  expect(presentation.toolbarHeight).toBe(presentation.workbenchHeaderHeight);
  expect(presentation.timelineTopPadding).toBeLessThanOrEqual(28);
  expect(presentation.composerBottomPadding).toBeLessThanOrEqual(8);
});

test("supports structured activity without Escape changing panel state", async ({ page }) => {
  await page.goto("/p/codexly/t/task-1");

  await expect(page.getByText("思考过程", { exact: true })).toHaveCount(0);
  await expect(page.getByText("分析工作台信息架构", { exact: true })).toHaveCount(0);
  await page.getByText("读取 Web 设计规范").click();
  await expect(page.getByText("docs/web-design.md")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary", { name: "项目侧栏" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "运行环境" })).toBeVisible();
});

test("resizes desktop workbench panels within bounds", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/p/codexly/t/task-1");

  await expect(page.getByRole("button", { name: "更多操作" })).toHaveCount(0);

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  const inspector = page.getByRole("complementary", { name: "运行环境" });
  const sidebarResizer = page.getByRole("separator", { name: "调整项目侧栏宽度" });
  const inspectorResizer = page.getByRole("separator", { name: "调整上下文面板宽度" });

  await expect(sidebarResizer).toHaveAttribute("aria-valuemin", "220");
  await expect(sidebarResizer).toHaveAttribute("aria-valuemax", "400");
  await expect(inspectorResizer).toHaveAttribute("aria-valuemin", "320");
  await expect(inspectorResizer).toHaveAttribute("aria-valuemax", "576");
  expect((await inspector.boundingBox())?.width).toBe(320);

  const sidebarResizerBox = await sidebarResizer.boundingBox();
  expect(sidebarResizerBox).not.toBeNull();
  await page.mouse.move(
    (sidebarResizerBox?.x ?? 0) + (sidebarResizerBox?.width ?? 0) / 2,
    (sidebarResizerBox?.y ?? 0) + 100,
  );
  await page.mouse.down();
  await page.mouse.move(900, 100);
  await page.mouse.up();
  expect((await sidebar.boundingBox())?.width).toBe(400);

  const expandedSidebarResizerBox = await sidebarResizer.boundingBox();
  await page.mouse.move((expandedSidebarResizerBox?.x ?? 0) + 4, 100);
  await page.mouse.down();
  await page.mouse.move(0, 100);
  await page.mouse.up();
  expect((await sidebar.boundingBox())?.width).toBe(220);
  await expect(inspectorResizer).toHaveAttribute("aria-valuemax", "610");

  const inspectorResizerBox = await inspectorResizer.boundingBox();
  expect(inspectorResizerBox).not.toBeNull();
  await page.mouse.move(
    (inspectorResizerBox?.x ?? 0) + (inspectorResizerBox?.width ?? 0) / 2,
    (inspectorResizerBox?.y ?? 0) + 100,
  );
  await page.mouse.down();
  await page.mouse.move(0, 100);
  await page.mouse.up();
  const timelineBox = await page.getByRole("main", { name: "任务时间线" }).boundingBox();
  expect((await inspector.boundingBox())?.width).toBe(610);
  expect(timelineBox?.width).toBe(610);

  const expandedInspectorResizerBox = await inspectorResizer.boundingBox();
  await page.mouse.move((expandedInspectorResizerBox?.x ?? 0) + 4, 100);
  await page.mouse.down();
  await page.mouse.move(1400, 100);
  await page.mouse.up();
  expect((await inspector.boundingBox())?.width).toBe(320);
});

test("uses the 320px inspector default on laptop-sized screens", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/p/codexly/t/task-1");

  const inspector = page.getByRole("complementary", { name: "运行环境" });
  expect((await inspector.boundingBox())?.width).toBe(320);
  await expect(inspector.getByRole("heading", { name: "运行环境" })).toHaveCount(0);
  await expect(inspector.getByRole("tab", { name: "项目" })).toBeVisible();
  await expect(inspector.getByRole("tab", { name: "上下文" })).toBeVisible();
});

test("keeps the narrow workbench layout stable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/p/codexly/t/task-1");

  await expect(page.getByRole("complementary", { name: "项目侧栏" })).not.toBeVisible();
  await page.getByRole("button", { name: "展开项目侧栏" }).click();
  await expect(page.getByRole("complementary", { name: "项目侧栏" })).toBeVisible();
  await page
    .getByRole("complementary", { name: "项目侧栏" })
    .getByRole("button", { name: "关闭项目侧栏" })
    .click();

  const timelineBox = await page.getByRole("main", { name: "任务时间线" }).boundingBox();

  expect(timelineBox).not.toBeNull();
  expect(timelineBox?.x).toBe(0);
  expect(timelineBox?.width).toBe(390);

  const hasHorizontalOverflow = await page
    .locator("html")
    .evaluate((root) => root.scrollWidth > root.clientWidth);
  expect(hasHorizontalOverflow).toBe(false);
});
