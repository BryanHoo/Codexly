import {
  expect,
  parseRequestRecord,
  projectGitStatus,
  taskSnapshot,
  test,
} from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("defaults historical tasks to project and keeps user-controlled tab selection", async ({
  page,
}) => {
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
    .toEqual(["项目", "上下文", "变更", "历史"]);
  await expect(contextTab).toHaveCSS("height", "24px");
  await expect(contextTab.locator("svg")).toHaveCSS("width", "14px");
  await expect(projectTab).toHaveAttribute("aria-selected", "true");
  const selectedStyle = await projectTab.evaluate((element) => {
    const style = getComputedStyle(element);
    return { backgroundColor: style.backgroundColor, color: style.color };
  });
  await contextTab.hover();
  await expect
    .poll(() =>
      contextTab.evaluate((element) => {
        const style = getComputedStyle(element);
        return { backgroundColor: style.backgroundColor, color: style.color };
      }),
    )
    .toEqual(selectedStyle);
  await contextTab.click();
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
  await expect(inspector.getByRole("tab", { name: "项目" })).toHaveAttribute(
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
  await expect.poll(readTabs).toEqual(["项目", "上下文", "历史"]);

  gitStatus = { ...projectGitStatus };
  await page.reload();
  await expect.poll(readTabs).toEqual(["项目", "上下文", "变更", "历史"]);

  detailedStatusRequestCount = 0;
  await page.goto("/p/codexly");
  await expect.poll(() => detailedStatusRequestCount).toBeGreaterThan(0);
});

test("keeps sidebar search and primary navigation compact", async ({ page }) => {
  await page.goto("/p/codexly/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  const newAgent = sidebar.getByRole("link", { name: "新建任务" });
  const extensionCenter = sidebar.getByRole("link", { name: "扩展中心" });
  const searchButton = sidebar.getByRole("button", { name: "全局搜索" });
  const search = page.getByRole("combobox", { name: "全局搜索" });
  const productBrand = sidebar.getByText("Codexly", { exact: true }).first();
  await expect(productBrand).toBeVisible();
  await expect(searchButton).toBeVisible();
  await expect(search).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "添加项目" })).toBeVisible();

  await searchButton.click();
  await expect(page.getByRole("dialog", { name: "全局搜索" })).toBeVisible();
  await expect(search).toBeVisible();
  await expect(search).toBeFocused();
  await search.fill("Protocol");
  await search.press("Escape");
  await expect(search).toHaveCount(0);
  await expect(searchButton).toBeFocused();

  const newAgentBox = await newAgent.boundingBox();
  const pinnedBox = await sidebar.getByRole("heading", { name: "已固定" }).boundingBox();
  const pinnedSection = sidebar.getByRole("heading", { name: "已固定" }).locator("xpath=..");
  const projectsBox = await sidebar.getByRole("heading", { name: "项目" }).boundingBox();
  const extensionCenterBox = await extensionCenter.boundingBox();
  const temporaryGroupBox = await sidebar.getByRole("region", { name: "聊天" }).boundingBox();
  const firstProjectBox = await sidebar
    .getByRole("button", { name: "切换项目 Codexly" })
    .boundingBox();
  expect(newAgentBox).not.toBeNull();
  expect(pinnedBox).not.toBeNull();
  expect(projectsBox).not.toBeNull();
  expect(extensionCenterBox).not.toBeNull();
  expect(temporaryGroupBox).not.toBeNull();
  expect(firstProjectBox).not.toBeNull();
  if (
    newAgentBox === null ||
    pinnedBox === null ||
    projectsBox === null ||
    extensionCenterBox === null ||
    temporaryGroupBox === null ||
    firstProjectBox === null
  ) {
    throw new Error("项目侧栏导航项缺失");
  }
  expect(newAgentBox.height).toBe(32);
  expect(extensionCenterBox.y + extensionCenterBox.height).toBeLessThanOrEqual(pinnedBox.y);
  expect(pinnedBox.y - (extensionCenterBox.y + extensionCenterBox.height)).toBeLessThanOrEqual(12);
  expect(newAgentBox.y).toBeLessThan(extensionCenterBox.y);
  expect(extensionCenterBox.y).toBeLessThan(pinnedBox.y);
  expect(pinnedBox.y).toBeLessThan(projectsBox.y);
  expect(firstProjectBox.y - (temporaryGroupBox.y + temporaryGroupBox.height)).toBe(0);
  await expect(pinnedSection.getByRole("link", { name: /补充 Protocol 契约/u })).toBeVisible();
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
  await expect
    .poll(() => readControlStyle(sidebar.getByRole("button", { name: "全局搜索" })))
    .toMatchObject({ display: "grid", height: "28px", width: "28px" });
  const addProjectIcon = sidebar.getByRole("button", { name: "添加项目" }).locator("svg");
  const addTaskIcon = sidebar.getByRole("button", { name: "在 Codexly 中新建任务" }).locator("svg");
  const temporaryAddTask = sidebar
    .getByRole("region", { name: "聊天" })
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
