import {
  chooseHostAttachment,
  expect,
  projects,
  taskSnapshot,
  test,
} from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("navigates absolute paths and toggles hidden folders in the project directory picker", async ({
  page,
}) => {
  const directoryRequests: URL[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/v1/project-directories") directoryRequests.push(url);
  });
  await page.goto("/p/codexly");
  await page.getByRole("button", { name: "添加项目" }).click();
  const picker = page.getByRole("dialog", { name: "选择项目文件夹" });
  const pathInput = picker.getByRole("textbox", { name: "绝对目录路径" });
  await pathInput.fill("/workspace/ProjectVault");
  await pathInput.press("Enter");

  await expect(picker.getByRole("button", { exact: true, name: "VisibleProject" })).toBeVisible();
  await expect(picker.getByRole("button", { exact: true, name: ".HiddenProject" })).toHaveCount(0);
  const hiddenToggle = picker.getByRole("button", { name: "显示隐藏文件夹" });
  await expect(hiddenToggle).toHaveAttribute("aria-pressed", "false");
  await hiddenToggle.click();
  await expect(picker.getByRole("button", { exact: true, name: ".HiddenProject" })).toBeVisible();
  await expect(picker.getByRole("button", { name: "隐藏隐藏文件夹" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect
    .poll(() =>
      directoryRequests.some(
        (url) =>
          url.searchParams.get("path") === "/workspace/ProjectVault" &&
          url.searchParams.get("includeHidden") === "true",
      ),
    )
    .toBe(true);
});

test("adds a validated absolute path directly as one project root", async ({ page }) => {
  let addProjectRequest: unknown;
  await page.route("**/v1/projects", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    addProjectRequest = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      json: {
        project: {
          createdAt: "2026-08-24T00:00:00.000Z",
          id: "project-vault",
          name: "ProjectVault",
          roots: [{ id: "root-project-vault", path: "/workspace/ProjectVault" }],
        },
      },
    });
  });
  await page.goto("/p/codexly");
  await page.getByRole("button", { name: "添加项目" }).click();
  const picker = page.getByRole("dialog", { name: "选择项目文件夹" });
  const pathInput = picker.getByRole("textbox", { name: "绝对目录路径" });

  await pathInput.fill("/workspace/ProjectVault");
  await pathInput.press("Enter");

  await expect(picker.getByText("已验证目录，可直接添加")).toBeVisible();
  const addButton = picker.getByRole("button", { name: "添加此文件夹" });
  await expect(addButton).toBeEnabled();
  await addButton.click();

  await expect(picker).toBeHidden();
  expect(addProjectRequest).toEqual({ roots: [{ path: "/workspace/ProjectVault" }] });
});

test("keeps the Web directory picker open after add failure", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error);
  });
  await page.route("**/v1/projects", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { code: "PROVIDER_ERROR", message: "Project picker failed", retryable: true },
      status: 502,
    });
  });
  await page.goto("/p/codexly");

  await page.getByRole("button", { name: "添加项目" }).click();
  const picker = page.getByRole("dialog", { name: "选择项目文件夹" });
  await picker.getByRole("checkbox", { name: "选择 AddedProject" }).click();
  await picker.getByRole("button", { name: "添加此文件夹" }).click();

  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveText(
    "Project picker failed",
  );
  await expect(picker.getByRole("alert")).toHaveCount(0);
  await expect(picker).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("keeps icon button tooltips visible within clipping and viewport boundaries", async ({
  page,
}) => {
  await page.goto("/p/codexly/t/task-1");

  const assertTooltipVisible = async (label: string) => {
    await page.getByRole("button", { exact: true, name: label }).hover();
    const tooltip = page.getByRole("tooltip", { exact: true, name: label });
    await expect(tooltip).toBeVisible();

    const placement = await tooltip.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      let clippedByAncestor = false;

      // Tooltip 不能越过任何实际裁剪它的祖先边界。
      for (
        let ancestor = element.parentElement;
        ancestor !== null;
        ancestor = ancestor.parentElement
      ) {
        const style = getComputedStyle(ancestor);
        const ancestorRect = ancestor.getBoundingClientRect();
        const clipsX = ["auto", "clip", "hidden", "scroll"].includes(style.overflowX);
        const clipsY = ["auto", "clip", "hidden", "scroll"].includes(style.overflowY);

        if (
          (clipsX && (rect.left < ancestorRect.left || rect.right > ancestorRect.right)) ||
          (clipsY && (rect.top < ancestorRect.top || rect.bottom > ancestorRect.bottom))
        ) {
          clippedByAncestor = true;
          break;
        }
      }

      return {
        bottom: rect.bottom,
        clippedByAncestor,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      };
    });

    expect(placement.clippedByAncestor).toBe(false);
    expect(placement.left).toBeGreaterThanOrEqual(8);
    expect(placement.right).toBeLessThanOrEqual(placement.viewportWidth - 8);
    expect(placement.top).toBeGreaterThanOrEqual(8);
    expect(placement.bottom).toBeLessThanOrEqual(placement.viewportHeight - 8);
  };

  await assertTooltipVisible("收起项目侧栏");
  await assertTooltipVisible("收起上下文面板");

  await page.setViewportSize({ height: 844, width: 390 });
  await assertTooltipVisible("展开项目侧栏");
  await assertTooltipVisible("展开上下文面板");
});

test("searches tasks across projects", async ({ page }) => {
  await page.goto("/p/codexly/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  await sidebar.getByRole("textbox", { name: "搜索任务" }).fill("Markdown");

  await expect(sidebar.getByRole("link", { name: /完善 Markdown 渲染/ })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: /构建 macOS 工作台/ })).not.toBeVisible();
});

test("opens and reuses project new chats without creating empty Codex tasks", async ({ page }) => {
  const taskCreationRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/v1\/projects\/[^/]+\/tasks$/u.test(request.url())) {
      taskCreationRequests.push(request.url());
    }
  });
  await page.goto("/p/superwork/t/plan-check");

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  await sidebar.getByRole("button", { name: "在 Codexly 中新建任务" }).click();
  await expect(page).toHaveURL(/\/p\/codexly$/);
  await expect(sidebar.getByRole("link", { name: "新聊天" })).toHaveCount(0);

  // 已经位于首个项目的新聊天时继续复用当前草稿，不创建空 Codex Task。
  await sidebar.getByRole("button", { name: "在 Codexly 中新建任务" }).click();
  await expect(page).toHaveURL(/\/p\/codexly$/);
  await sidebar.getByRole("button", { name: "在 superwork 中新建任务" }).click();
  await expect(page).toHaveURL(/\/p\/superwork$/);
  await expect(sidebar.getByRole("link", { name: "新聊天" })).toHaveCount(0);
  expect(taskCreationRequests).toEqual([]);
});

test("shows a newly submitted task and AI reply state before the task snapshot loads", async ({
  page,
}) => {
  let taskStartRequestCount = 0;
  const createdTask = {
    id: "019f9d81-13ab-7863-9676-beae70726117",
    pinned: false,
    projectId: "codexly",
    title: "新聊天",
    updatedAt: "2026-07-26T08:00:00.000Z",
  };
  const startedTurn = {
    completedAt: null,
    error: null,
    id: "turn-new-task",
    // 模拟 turn/start 只返回运行态、用户 Item 尚未进入 Snapshot 的真实窗口。
    items: [],
    startedAt: "2026-07-26T08:00:00.000Z",
    status: "running",
  };
  let releaseTurnStartRequest: () => void = () => undefined;
  const turnStartGate = new Promise<void>((resolve) => {
    releaseTurnStartRequest = resolve;
  });
  let releaseSnapshotRequest: () => void = () => undefined;
  let snapshotResponseSent = false;
  const snapshotGate = new Promise<void>((resolve) => {
    releaseSnapshotRequest = resolve;
  });

  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/projects/codexly/tasks" && route.request().method() === "POST") {
      taskStartRequestCount += 1;
      await route.fulfill({ contentType: "application/json", json: { task: createdTask } });
      return;
    }
    if (
      url.pathname === `/v1/projects/codexly/tasks/${createdTask.id}/turns` &&
      route.request().method() === "POST"
    ) {
      await turnStartGate;
      await route.fulfill({
        contentType: "application/json",
        json: { taskId: createdTask.id, turn: startedTurn },
      });
      return;
    }
    if (
      url.pathname === `/v1/projects/codexly/tasks/${createdTask.id}` &&
      route.request().method() === "GET"
    ) {
      await snapshotGate;
      await route.fulfill({
        contentType: "application/json",
        json: {
          checkpoint: { sequence: 0, sessionId: "e2e-session" },
          snapshot: {
            ...createdTask,
            contextUsage: null,
            goal: null,
            plan: null,
            pendingRequests: [],
            settings: taskSnapshot.settings,
            status: "running",
            turns: [startedTurn],
            turnsNextCursor: null,
          },
        },
      });
      snapshotResponseSent = true;
      return;
    }
    await route.fallback();
  });

  await page.goto("/p/codexly");
  await page.getByRole("textbox", { name: "任务输入" }).fill("你好");
  await page.getByRole("button", { exact: true, name: "提交" }).evaluate((button) => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect.poll(() => taskStartRequestCount).toBe(1);

  // Codex 返回真实 taskId 后立即写入并选中 Sidebar，中栏仍保留可重试的 Project 草稿。
  await expect(page).toHaveURL(/\/p\/codexly$/u);
  const main = page.getByRole("main", { name: "任务时间线" });
  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  const runningTaskLink = sidebar.getByRole("link", { name: "新聊天" });
  await expect(runningTaskLink).toHaveAttribute("aria-current", "page");

  releaseTurnStartRequest();

  await expect(page).toHaveURL(new RegExp(`/p/codexly/t/${createdTask.id}$`, "u"));
  await expect(main.getByRole("heading", { name: "新聊天" })).toBeVisible();
  const timelineMessages = main.locator('[role="log"] article');
  await expect(timelineMessages.nth(0)).toContainText("你好");
  await expect(timelineMessages.nth(1)).toContainText("正在运行");
  await expect(main.locator("[data-turn-processing-time]").last()).toBeVisible();
  await expect(runningTaskLink.getByRole("status", { name: "任务运行中" })).toBeVisible();
  await expect(runningTaskLink.locator(".task-age")).toHaveCount(0);
  await expect(main.getByText(createdTask.id, { exact: true })).toHaveCount(0);

  releaseSnapshotRequest();
  await expect.poll(() => snapshotResponseSent).toBe(true);
  // 运行中 Snapshot 尚未落入用户 Item 时，已提交消息也不能从 Timeline 消失。
  await expect(timelineMessages.nth(0)).toContainText("你好");
  await expect(timelineMessages.nth(1)).toContainText("正在运行");
  await expect(main.locator("[data-turn-processing-time]").last()).toBeVisible();
});

test("stores new-chat text and attachments independently between projects", async ({ page }) => {
  await page.goto("/p/codexly");
  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.fill("保留这段新聊天草稿");
  await chooseHostAttachment(page, "image", "draft.png");
  await expect(page.getByText("draft.png", { exact: true })).toBeVisible();

  const projectSelect = page.getByRole("combobox", { name: "选择新聊天项目" });
  await expect(projectSelect).toBeVisible();
  const projectSelectLabel = projectSelect.locator("xpath=preceding-sibling::*[1]");
  // 可见名称表达可切换状态，透明原生选择器只负责交互。
  await expect(projectSelect).toHaveCSS("appearance", "none");
  await expect(projectSelect).toHaveCSS("opacity", "0");
  await expect(projectSelectLabel).toHaveCSS("text-decoration-line", "underline");
  await expect(projectSelect.locator("xpath=following-sibling::*")).toHaveCount(0);
  await projectSelect.selectOption("superwork");

  await expect(page).toHaveURL(/\/p\/superwork$/);
  await expect(projectSelect).toHaveValue("superwork");
  await expect(prompt).toHaveAttribute("data-serialized-value", "");
  await expect(page.getByText("draft.png", { exact: true })).toHaveCount(0);
  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  // 切换当前 Project 不覆盖用户保存的文件夹展开形态。
  await expect(sidebar.getByRole("button", { name: "切换项目 superwork" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(sidebar.getByRole("link", { name: "新聊天" })).toHaveCount(0);

  await projectSelect.selectOption("codexly");

  await expect(page).toHaveURL(/\/p\/codexly$/);
  await expect(prompt).toHaveAttribute("data-serialized-value", "保留这段新聊天草稿");
  await expect(page.getByText("draft.png", { exact: true })).toBeVisible();
});

test("sizes and vertically aligns the empty-chat project selector", async ({ page }) => {
  await page.route("**/v1/projects", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: {
        data: projects.map((project) =>
          project.id === "superwork"
            ? { ...project, name: "a-project-name-that-is-much-longer-than-Codexly" }
            : project,
        ),
        nextCursor: null,
      },
    });
  });
  await page.goto("/p/codexly");

  const projectSelect = page.getByRole("combobox", { name: "选择新聊天项目" });
  await expect(projectSelect).toBeVisible();
  const geometry = await projectSelect.evaluate((select) => {
    const label = select.previousElementSibling;
    const wrapper = select.parentElement;
    const heading = wrapper?.parentElement;
    if (
      !(label instanceof HTMLElement) ||
      !(wrapper instanceof HTMLElement) ||
      !(heading instanceof HTMLHeadingElement)
    ) {
      throw new Error("项目选择器缺少用于垂直居中的可见标签");
    }
    const headingStyle = getComputedStyle(heading);
    const labelStyle = getComputedStyle(label);
    const labelBounds = label.getBoundingClientRect();
    return {
      headingAlignItems: headingStyle.alignItems,
      headingDisplay: headingStyle.display,
      headingLineHeight: headingStyle.lineHeight,
      labelLineHeight: labelStyle.lineHeight,
      labelVisibility: labelStyle.visibility,
      labelWidth: labelBounds.width,
      selectOpacity: getComputedStyle(select).opacity,
      selectWidth: select.getBoundingClientRect().width,
    };
  });

  expect(geometry.headingDisplay).toBe("flex");
  expect(geometry.headingAlignItems).toBe("center");
  expect(Math.abs(geometry.selectWidth - geometry.labelWidth)).toBeLessThanOrEqual(1);
  expect(geometry.labelVisibility).toBe("visible");
  expect(geometry.selectOpacity).toBe("0");
  expect(geometry.labelLineHeight).toBe(geometry.headingLineHeight);
});

test("toggles project tasks from the project name without navigation", async ({ page }) => {
  await page.goto("/p/codexly/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  const task = sidebar.getByRole("link", { name: /优化输入框交互/ });
  await expect(task).toBeVisible();

  await sidebar.getByRole("button", { name: "切换项目 Codexly" }).click();
  await expect(task).not.toBeVisible();
  await expect(page).toHaveURL(/\/p\/codexly\/t\/task-1$/);

  await expect(sidebar.getByRole("button", { name: "在 Codexly 中新建任务" })).toBeVisible();
  await sidebar.getByRole("button", { name: "切换项目 Codexly" }).click();
  await expect(task).toBeVisible();
  await expect(page).toHaveURL(/\/p\/codexly\/t\/task-1$/);
});

test("loads tasks only for the current or expanded projects", async ({ page }) => {
  let superworkTaskRequests = 0;
  let superworkPinnedTaskRequests = 0;
  await page.route("**/v1/projects/superwork/tasks?*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.searchParams.get("pinned") === "true") {
      superworkPinnedTaskRequests += 1;
    } else {
      superworkTaskRequests += 1;
    }
    await route.fallback();
  });

  await page.goto("/p/codexly/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  await expect(sidebar.getByRole("link", { name: "优化输入框交互" })).toBeVisible();
  await expect.poll(() => superworkPinnedTaskRequests).toBe(1);
  expect(superworkTaskRequests).toBe(0);

  await sidebar.getByRole("button", { name: "切换项目 superwork" }).click();

  await expect.poll(() => superworkTaskRequests).toBe(1);
});
