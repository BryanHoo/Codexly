import {
  expect,
  parseRequestRecord,
  projectGitStatus,
  taskSnapshot,
  test,
} from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("defaults task context and keeps user-controlled tab selection", async ({ page }) => {
  let snapshotRequestCount = 0;
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    snapshotRequestCount += 1;
    await route.fulfill({
      contentType: "application/json",
      json: {
        checkpoint: { sequence: 0, sessionId: "e2e-session" },
        snapshot: {
          ...taskSnapshot,
          plan: {
            explanation: "先完成协议，再验证右栏交互。",
            steps: [
              { status: "completed", text: "定义计划协议" },
              { status: "in_progress", text: "接入上下文 Queue" },
              { status: "pending", text: "执行回归验证" },
            ],
          },
        },
      },
    });
  });
  await page.goto("/p/codexly/t/task-1");
  await expect.poll(() => snapshotRequestCount).toBeGreaterThan(0);

  const inspector = page.getByRole("complementary", { name: "运行环境" });
  const projectTab = inspector.getByRole("tab", { name: "项目" });
  const contextTab = inspector.getByRole("tab", { name: "上下文" });
  await expect
    .poll(() => inspector.locator('[role="tablist"]').first().getByRole("tab").allTextContents())
    .toEqual(["上下文", "项目", "变更", "历史"]);
  await expect(contextTab).toHaveCSS("height", "24px");
  await expect(contextTab.locator("svg")).toHaveCSS("width", "14px");
  await expect(contextTab).toHaveAttribute("aria-selected", "true");
  const selectedStyle = await contextTab.evaluate((element) => {
    const style = getComputedStyle(element);
    return { backgroundColor: style.backgroundColor, color: style.color };
  });
  await projectTab.hover();
  await expect
    .poll(() =>
      projectTab.evaluate((element) => {
        const style = getComputedStyle(element);
        return { backgroundColor: style.backgroundColor, color: style.color };
      }),
    )
    .toEqual(selectedStyle);
  const plan = inspector.getByRole("region", { name: "计划" });
  await expect(plan).toBeVisible();
  await expect(plan.getByText("定义计划协议")).toBeVisible();
  await expect(plan.getByText("接入上下文 Queue")).toBeVisible();
  await expect(plan.getByText("执行回归验证")).toBeVisible();
  await expect(plan.locator('[data-status="completed"]')).toHaveCount(1);
  await expect(plan.locator('[data-status="in_progress"]')).toHaveCount(1);
  await expect(plan.locator('[data-status="pending"]')).toHaveCount(1);
});

test("shows context only after a task has been created", async ({ page }) => {
  await page.goto("/p/codexly");

  const inspector = page.getByRole("complementary", { name: "运行环境" });
  await expect(inspector.getByRole("tab", { name: "项目" })).toBeVisible();
  await expect(inspector.getByRole("tab", { name: "上下文" })).toHaveCount(0);

  await page.goto("/p/codexly/t/task-1");
  await expect(inspector.getByRole("tab", { name: "上下文" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(inspector.getByRole("tab", { name: "项目" })).toBeVisible();
});

test("shows Git tabs only for repositories and pending changes", async ({ page }) => {
  let detailedStatusRequestCount = 0;
  let gitStatus: typeof projectGitStatus = {
    ...projectGitStatus,
    repositoryMode: "none",
    staged: [],
    unstaged: [],
  };
  await page.route("**/v1/projects/codexly/git/status*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("includeDiff") === "true") {
      detailedStatusRequestCount += 1;
    }
    await route.fulfill({ contentType: "application/json", json: gitStatus });
  });

  await page.goto("/p/codexly");
  const inspector = page.getByRole("complementary", { name: "运行环境" });
  const readTabs = () =>
    inspector.locator('[role="tablist"]').first().getByRole("tab").allTextContents();
  await expect.poll(readTabs).toEqual(["项目"]);

  gitStatus = { ...projectGitStatus, staged: [], unstaged: [] };
  await page.goto("/p/codexly/t/task-1");
  await expect.poll(readTabs).toEqual(["上下文", "项目", "历史"]);

  gitStatus = { ...projectGitStatus };
  await page.reload();
  await expect.poll(readTabs).toEqual(["上下文", "项目", "变更", "历史"]);

  detailedStatusRequestCount = 0;
  await page.goto("/p/codexly");
  await expect.poll(() => detailedStatusRequestCount).toBeGreaterThan(0);
});

test("orders persistent search, task actions, pinned tasks and projects in the sidebar", async ({
  page,
}) => {
  await page.goto("/p/codexly/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  const newAgent = sidebar.getByRole("link", { name: "新建任务" });
  const search = sidebar.getByRole("textbox", { name: "搜索任务" });
  const productBrand = sidebar.getByText("Codexly", { exact: true }).first();
  await expect(productBrand).toBeVisible();
  await expect(search).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "搜索" })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "添加项目" })).toBeVisible();

  const newAgentBox = await newAgent.boundingBox();
  const searchBox = await search.boundingBox();
  const pinnedBox = await sidebar.getByRole("heading", { name: "已固定" }).boundingBox();
  const pinnedSection = sidebar.getByRole("heading", { name: "已固定" }).locator("xpath=..");
  const projectsBox = await sidebar.getByRole("heading", { name: "项目" }).boundingBox();
  const temporaryGroupBox = await sidebar.getByRole("region", { name: "临时任务" }).boundingBox();
  const firstProjectBox = await sidebar
    .getByRole("button", { name: "切换项目 Codexly" })
    .boundingBox();
  expect(newAgentBox).not.toBeNull();
  expect(searchBox).not.toBeNull();
  expect(pinnedBox).not.toBeNull();
  expect(projectsBox).not.toBeNull();
  expect(temporaryGroupBox).not.toBeNull();
  expect(firstProjectBox).not.toBeNull();
  if (
    newAgentBox === null ||
    searchBox === null ||
    pinnedBox === null ||
    projectsBox === null ||
    temporaryGroupBox === null ||
    firstProjectBox === null
  ) {
    throw new Error("项目侧栏导航项缺失");
  }
  expect(searchBox.y).toBeLessThan(newAgentBox.y);
  expect(newAgentBox.y).toBeLessThan(pinnedBox.y);
  expect(pinnedBox.y).toBeLessThan(projectsBox.y);
  expect(firstProjectBox.y - (temporaryGroupBox.y + temporaryGroupBox.height)).toBe(0);
  await expect(pinnedSection.getByRole("link", { name: /补充 Protocol 契约/u })).toBeVisible();
});

test("manages searchable paginated archived tasks from the project menu", async ({ page }) => {
  const archivedTasks = Array.from({ length: 21 }, (_, index) => ({
    id: `archived-${String(index + 1)}`,
    pinned: false,
    projectId: "codexly",
    title: index === 20 ? "搜索命中的归档任务" : `归档任务 ${String(index + 1)}`,
    updatedAt: "2026-08-23T00:00:00.000Z",
  }));
  let restoredTaskId: string | null = null;
  const deletedTaskIds = new Set<string>();

  await page.route("**/v1/projects/codexly/tasks?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("archived") !== "true") {
      await route.fallback();
      return;
    }
    const searchTerm = url.searchParams.get("searchTerm");
    const cursor = url.searchParams.get("cursor");
    const available = archivedTasks.filter(
      (task) =>
        task.id !== restoredTaskId &&
        !deletedTaskIds.has(task.id) &&
        (searchTerm === null || task.title.includes(searchTerm)),
    );
    const start = cursor === "page-2" ? 20 : 0;
    await route.fulfill({
      contentType: "application/json",
      json: {
        data: available.slice(start, start + 20),
        nextCursor: start === 0 && available.length > 20 ? "page-2" : null,
      },
    });
  });
  await page.route("**/v1/projects/codexly/tasks/*/unarchive", async (route) => {
    restoredTaskId = /tasks\/([^/]+)\/unarchive$/u.exec(route.request().url())?.[1] ?? null;
    const task = archivedTasks.find((item) => item.id === restoredTaskId);
    await route.fulfill({ contentType: "application/json", json: { task } });
  });
  await page.route("**/v1/projects/codexly/tasks/archived-*", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.fallback();
      return;
    }
    const deletedTaskId = /tasks\/([^/?]+)$/u.exec(route.request().url())?.[1] ?? null;
    if (deletedTaskId !== null) deletedTaskIds.add(deletedTaskId);
    await route.fulfill({
      contentType: "application/json",
      json: { status: "deleted", taskId: deletedTaskId },
    });
  });

  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("button", { name: "打开 Codexly 的项目操作菜单" }).click();
  await page.getByRole("menuitem", { name: "已归档" }).click();

  const dialog = page.getByRole("dialog", { name: "Codexly 的已归档任务" });
  await expect(dialog.getByText("归档任务 1", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "下一页" })).toBeEnabled();
  await dialog.getByRole("button", { name: "下一页" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByText("第 2 页", { exact: true })).toBeVisible();
  await expect(dialog.getByText("搜索命中的归档任务", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "上一页" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByText("第 1 页", { exact: true })).toBeVisible();
  await dialog.getByRole("textbox", { name: "搜索已归档任务" }).fill("搜索命中");
  await expect(dialog.getByText("搜索命中的归档任务", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "恢复任务 搜索命中的归档任务" }).click();
  await expect.poll(() => restoredTaskId).toBe("archived-21");
  await dialog.getByRole("textbox", { name: "搜索已归档任务" }).fill("归档任务 1");
  await dialog.getByRole("button", { name: "永久删除任务 归档任务 1", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "永久删除任务" });
  await confirmation.getByRole("button", { name: "永久删除" }).click();
  await expect.poll(() => deletedTaskIds.has("archived-1")).toBe(true);

  await dialog.getByRole("button", { name: "全部删除" }).click();
  const deleteAllConfirmation = page.getByRole("dialog", {
    name: "永久删除全部已归档任务",
  });
  await expect(deleteAllConfirmation).toContainText("Codexly");
  await deleteAllConfirmation.getByRole("button", { name: "全部永久删除" }).click();
  await expect.poll(() => deletedTaskIds.size).toBe(20);
  await expect(dialog.getByText("没有已归档任务", { exact: true })).toBeVisible();
});

test("preserves the original sidebar control typography and dimensions", async ({ page }) => {
  await page.goto("/p/codexly/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  const readControlStyle = (selector: ReturnType<typeof sidebar.getByRole>) =>
    selector.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        display: style.display,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        height: style.height,
        justifyContent: style.justifyContent,
        width: style.width,
      };
    });

  await expect
    .poll(() => readControlStyle(sidebar.getByRole("button", { name: "切换项目 Codexly" })))
    .toMatchObject({
      display: "flex",
      fontSize: "13px",
      fontWeight: "550",
      height: "32px",
      justifyContent: "flex-start",
    });
  await expect
    .poll(() => readControlStyle(page.locator("#global-settings-trigger")))
    .toMatchObject({
      display: "flex",
      fontSize: "13px",
      fontWeight: "450",
      height: "36px",
      justifyContent: "flex-start",
    });
  await expect
    .poll(() => readControlStyle(sidebar.getByRole("button", { name: "添加项目" })))
    .toMatchObject({ display: "grid", height: "28px", width: "28px" });
  const addProjectIcon = sidebar.getByRole("button", { name: "添加项目" }).locator("svg");
  const addTaskIcon = sidebar.getByRole("button", { name: "在 Codexly 中新建任务" }).locator("svg");
  const temporaryAddTask = sidebar
    .getByRole("region", { name: "临时任务" })
    .getByRole("button", { name: "新建任务" });
  const projectAddTask = sidebar.getByRole("button", { name: "在 Codexly 中新建任务" });
  await expect(addProjectIcon).toHaveCSS("height", "14px");
  await expect(addProjectIcon).toHaveCSS("width", "14px");
  await expect(addTaskIcon).toHaveCSS("height", "14px");
  await expect(addTaskIcon).toHaveCSS("width", "14px");
  const [temporaryAddTaskBox, projectAddTaskBox] = await Promise.all([
    temporaryAddTask.boundingBox(),
    projectAddTask.boundingBox(),
  ]);
  expect(temporaryAddTaskBox).not.toBeNull();
  expect(projectAddTaskBox).not.toBeNull();
  if (temporaryAddTaskBox === null || projectAddTaskBox === null) {
    throw new Error("Sidebar 新建任务按钮缺失");
  }
  expect(
    Math.abs(
      temporaryAddTaskBox.x +
        temporaryAddTaskBox.width -
        (projectAddTaskBox.x + projectAddTaskBox.width),
    ),
  ).toBeLessThanOrEqual(1);
  await expect(sidebar.getByRole("textbox", { name: "搜索任务" })).toHaveCSS("height", "36px");
});

test("uses the brand logo across the sidebar and favicon", async ({ page }) => {
  await page.goto("/p/codexly");

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  const productBrand = sidebar.getByRole("img", { name: "Codexly" });

  await expect(productBrand).toBeVisible();
  await expect(productBrand).toHaveAttribute("src", "/brand/codexly-logo.svg");
  await expect(sidebar.getByText("CA", { exact: true })).toHaveCount(0);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon.svg?v=4");

  expect(
    await productBrand.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        height: style.height,
        width: style.width,
      };
    }),
  ).toEqual({
    height: "28px",
    width: "115.5px",
  });

  const faviconResponse = await page.request.get("/favicon.svg?v=4");
  expect(faviconResponse.ok()).toBe(true);
  const favicon = await faviconResponse.text();
  const faviconDefinition = await page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, "image/svg+xml");
    const root = document.documentElement;
    const background = document.querySelector(".mark-background");
    const symbol = document.querySelector("#codexly-symbol");
    return {
      height: background?.getAttribute("height"),
      pathCount: symbol?.querySelectorAll("path").length,
      radius: background?.getAttribute("rx"),
      viewBox: root.getAttribute("viewBox"),
      width: background?.getAttribute("width"),
    };
  }, favicon);
  expect(faviconDefinition).toEqual({
    height: "64",
    pathCount: 2,
    radius: "14",
    viewBox: "0 0 64 64",
    width: "64",
  });
});

test("adds a folder through the Web project directory picker", async ({ page }) => {
  let addProjectRequestCount = 0;
  let addedRootPaths: unknown;
  let delayCurrentTaskRefresh = false;
  let releaseCurrentTaskRefresh: () => void = () => undefined;
  const currentTaskRefreshGate = new Promise<void>((resolve) => {
    releaseCurrentTaskRefresh = resolve;
  });
  await page.route("**/v1/projects", async (route) => {
    if (route.request().method() === "POST") {
      addProjectRequestCount += 1;
      const roots = Reflect.get(parseRequestRecord(route.request().postData()), "roots");
      addedRootPaths = Array.isArray(roots)
        ? roots.map((root: unknown) =>
            typeof root === "object" && root !== null && !Array.isArray(root)
              ? (root as { path?: unknown }).path
              : root,
          )
        : roots;
    }
    await route.fallback();
  });
  await page.route("**/v1/projects/codexly/tasks?*", async (route) => {
    if (delayCurrentTaskRefresh) {
      await currentTaskRefreshGate;
    }
    await route.fallback();
  });
  await page.goto("/p/codexly/t/task-1");

  await page.getByRole("button", { name: "添加项目" }).click();
  const picker = page.getByRole("dialog", { name: "选择项目文件夹" });
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "取消" }).click();
  await expect(picker).toBeHidden();
  expect(addProjectRequestCount).toBe(0);

  await page.getByRole("button", { name: "添加项目" }).click();
  const addButton = picker.getByRole("button", { name: "添加此文件夹" });
  await expect(addButton).toBeDisabled();
  await picker.getByRole("button", { exact: true, name: "AddedProject" }).click();
  await expect(picker.getByRole("checkbox", { name: "选择 AddedProject" })).not.toBeChecked();
  await expect(addButton).toBeDisabled();

  await picker.getByRole("checkbox", { name: "选择 AddedProject" }).click();
  await picker.getByRole("checkbox", { name: "选择 superwork" }).click();
  await expect(picker.getByText("已选择 2 个项目目录")).toBeVisible();
  await expect(picker.getByText("首个勾选的文件夹将作为主目录")).toBeVisible();
  await expect(
    picker.getByText("/workspace/AddedProject（主目录）、/workspace/superwork", { exact: true }),
  ).toBeVisible();
  await expect(
    picker.getByRole("button", { name: "将 /workspace/superwork 设为主目录" }),
  ).toHaveCount(0);
  await expect(addButton).toBeEnabled();
  delayCurrentTaskRefresh = true;
  await addButton.evaluate((button) => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  try {
    await expect(picker).toBeHidden({ timeout: 500 });
    await expect(page).toHaveURL(/\/p\/codexly\/t\/task-1$/);
    expect(addProjectRequestCount).toBe(1);
    expect(addedRootPaths).toEqual(["/workspace/AddedProject", "/workspace/superwork"]);
    await expect(
      page.getByRole("complementary", { name: "项目侧栏" }).getByText("AddedProject", {
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    releaseCurrentTaskRefresh();
  }
});

test("switches every project view to the selected aggregate root", async ({ page }) => {
  const scopedRequests: URL[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (/^\/v1\/projects\/superwork\/(?:git\/status|files\/tree)$/u.test(url.pathname)) {
      scopedRequests.push(url);
    }
  });
  await page.goto("/p/superwork");

  const rootControls = page.locator("[data-composer-project-root-controls]");
  const rootSelector = rootControls.getByRole("combobox", { name: "选择项目目录" });
  const projectPath = rootControls.getByRole("button", { name: "在系统文件夹中打开" });
  await expect(page.locator("header").getByRole("combobox", { name: "选择项目目录" })).toHaveCount(
    0,
  );
  await expect(rootSelector).toContainText("superwork");
  await expect(projectPath).toContainText("/workspace/superwork");
  const [rootSelectorBox, projectPathBox] = await Promise.all([
    rootSelector.boundingBox(),
    projectPath.boundingBox(),
  ]);
  expect(rootSelectorBox).not.toBeNull();
  expect(projectPathBox).not.toBeNull();
  expect((rootSelectorBox?.x ?? 0) + (rootSelectorBox?.width ?? 0)).toBeLessThanOrEqual(
    projectPathBox?.x ?? 0,
  );
  await expect
    .poll(() =>
      rootSelector.locator("svg").evaluateAll((icons) =>
        icons.map((icon) => {
          const style = getComputedStyle(icon);
          return `${style.width}x${style.height}`;
        }),
      ),
    )
    .toEqual(["12pxx12px", "12pxx12px"]);

  await rootSelector.click();
  const selectedRootOption = page.getByRole("option", { name: /superwork/u });
  await expect(selectedRootOption).toBeVisible();
  await expect
    .poll(() =>
      selectedRootOption.locator("svg").evaluateAll((icons) =>
        icons.map((icon) => {
          const style = getComputedStyle(icon);
          return `${style.width}x${style.height}`;
        }),
      ),
    )
    .toEqual(["14pxx14px"]);
  await page.getByRole("option", { name: /shared/u }).click();

  await expect(rootSelector).toContainText("shared");
  await expect(projectPath).toContainText("/workspace/shared");
  await expect(page.getByRole("button", { name: "切换分支，当前分支 shared-main" })).toBeVisible();
  await expect
    .poll(() =>
      [
        ...new Set(
          scopedRequests
            .filter((url) => url.searchParams.get("rootPath") === "/workspace/shared")
            .map((url) => url.pathname),
        ),
      ].sort(),
    )
    .toEqual(["/v1/projects/superwork/files/tree", "/v1/projects/superwork/git/status"]);

  await page.setViewportSize({ height: 720, width: 320 });
  await expect(rootControls).toBeVisible();
  const rootControlsBox = await rootControls.boundingBox();
  expect(rootControlsBox).not.toBeNull();
  expect(rootControlsBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((rootControlsBox?.x ?? 321) + (rootControlsBox?.width ?? 0)).toBeLessThanOrEqual(320);
});
