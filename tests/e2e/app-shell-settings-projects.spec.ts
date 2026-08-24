import {
  expect,
  parseRequestRecord,
  taskSnapshot,
  taskSnapshotResponse,
  test,
} from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("项目文件夹操作支持重命名和删除且不修改磁盘目录", async ({ page }) => {
  await page.goto("/p/code-agent");
  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  const projectMenuTrigger = sidebar.getByRole("button", {
    name: "打开 CodeAgent 的项目操作菜单",
  });
  const addTaskButton = sidebar.getByRole("button", { name: "在 CodeAgent 中新建任务" });
  const [menuTriggerBounds, addTaskBounds] = await Promise.all([
    projectMenuTrigger.boundingBox(),
    addTaskButton.boundingBox(),
  ]);
  if (menuTriggerBounds === null || addTaskBounds === null) {
    throw new Error("Project action buttons are not visible");
  }
  expect(menuTriggerBounds.x).toBeLessThan(addTaskBounds.x);

  await projectMenuTrigger.click();
  const projectMenu = page.getByRole("menu", { name: "CodeAgent 的项目操作" });
  await expect(projectMenu.getByRole("menuitem")).toHaveCount(3);
  await expect(projectMenu.getByRole("menuitem").allTextContents()).resolves.toEqual([
    "重命名",
    "已归档",
    "删除",
  ]);
  await projectMenu.getByRole("menuitem", { name: "重命名" }).click();
  const renameDialog = page.getByRole("dialog", { name: "重命名项目" });
  await expect(renameDialog).toContainText("不会修改磁盘上的文件夹名称");
  await renameDialog.getByRole("textbox", { name: "项目名称" }).fill("本地工作台");
  const renameRequestPromise = page.waitForRequest(
    (request) =>
      request.url().endsWith("/v1/projects/code-agent/rename") && request.method() === "POST",
  );
  const renameResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/v1/projects/code-agent/rename"),
  );
  await renameDialog.getByRole("button", { name: "保存" }).click();
  const [renameRequest, renameResponse] = await Promise.all([
    renameRequestPromise,
    renameResponsePromise,
  ]);
  expect(parseRequestRecord(renameRequest.postData())).toEqual({ name: "本地工作台" });
  expect(renameRequest.headers()["idempotency-key"]).toBeTruthy();
  await expect(renameResponse.json()).resolves.toMatchObject({
    project: { name: "本地工作台", roots: [{ path: "/workspace/CodeAgent" }] },
  });
  await expect(sidebar.getByRole("button", { name: "切换项目 本地工作台" })).toBeVisible();
  await expect(page).toHaveURL(/\/p\/code-agent$/u);

  await sidebar.getByRole("button", { name: "打开 本地工作台 的项目操作菜单" }).click();
  await page
    .getByRole("menu", { name: "本地工作台 的项目操作" })
    .getByRole("menuitem", { name: "删除" })
    .click();
  const removeDialog = page.getByRole("dialog", { name: "移除项目" });
  await expect(removeDialog).toContainText("不会删除磁盘上的文件夹及文件");
  const removeRequestPromise = page.waitForRequest((request) =>
    request.url().endsWith("/v1/projects/code-agent/remove"),
  );
  await removeDialog.getByRole("button", { name: "删除" }).click();
  const removeRequest = await removeRequestPromise;
  expect(removeRequest.headers()["idempotency-key"]).toBeTruthy();
  await expect(page).toHaveURL(/\/p\/superwork$/u);
  await expect(sidebar.getByRole("button", { name: "切换项目 本地工作台" })).toHaveCount(0);

  await sidebar.getByRole("button", { name: "打开 superwork 的项目操作菜单" }).click();
  await page
    .getByRole("menu", { name: "superwork 的项目操作" })
    .getByRole("menuitem", { name: "删除" })
    .click();
  const removeLastProjectRequest = page.waitForRequest((request) =>
    request.url().endsWith("/v1/projects/superwork/remove"),
  );
  await page
    .getByRole("dialog", { name: "移除项目" })
    .getByRole("button", { name: "删除" })
    .click();
  await removeLastProjectRequest;

  await expect(page).toHaveURL(/\/temporary$/u);
  await expect(sidebar.getByRole("button", { name: /^切换项目 /u })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "任务输入" })).toBeEnabled();
});

test("removes the legacy workspace routes", async ({ page }) => {
  for (const path of ["/login", "/workspaces", "/w/demo", "/w/demo/t/thread-1"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "页面不存在" })).toBeVisible();
  }
});

test("directs unavailable Runtime users to the official Codex CLI", async ({ page }) => {
  let modelRequestCount = 0;
  await page.route("**/v1/models", async (route) => {
    modelRequestCount += 1;
    await route.fulfill({
      contentType: "application/json",
      json: { message: "Provider unavailable" },
      status: 503,
    });
  });

  await page.goto("/p/code-agent");

  await expect(page.getByRole("heading", { name: "Codex Runtime 不可用" })).toBeVisible();
  await expect(page.getByText("codex login", { exact: true })).toBeVisible();

  const requestCountBeforeRetry = modelRequestCount;
  await page.getByRole("button", { name: "重试" }).click();
  await expect.poll(() => modelRequestCount).toBeGreaterThan(requestCountBeforeRetry);
});

test("keeps a healthy project usable when another project task query fails", async ({ page }) => {
  let failedProjectRequestCount = 0;
  await page.route("**/v1/projects/superwork/tasks?*", async (route) => {
    failedProjectRequestCount += 1;
    await route.fulfill({
      contentType: "application/json",
      json: { message: "Project unavailable" },
      status: 503,
    });
  });

  await page.goto("/p/code-agent/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  expect(failedProjectRequestCount).toBe(0);
  await sidebar.getByRole("button", { name: "切换项目 superwork" }).click();

  await expect.poll(() => failedProjectRequestCount).toBe(2);
  await expect(page.getByRole("heading", { name: "构建 macOS 工作台" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Codex Runtime 不可用" })).toHaveCount(0);
});

test("renders skills from a reopened task history", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");

  const historicalSkill = page.locator('[data-message-skill="review-security"]');
  await expect(historicalSkill).toContainText("$review-security");
  await expect(historicalSkill).toHaveCSS("color", "rgb(0, 106, 255)");
  await expect(page.getByText("完成 macOS 原生风格的三栏工作台页面。")).toBeVisible();
});

test("uses the available user message width before wrapping or truncating", async ({ page }) => {
  await page.route("**/v1/projects/code-agent/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshotResponse.snapshot,
          turns: [
            {
              ...taskSnapshot.turns[0],
              items: [
                {
                  id: "message-short-text",
                  role: "user",
                  skills: [],
                  text: "现在系统的 gh cli 是可以用的",
                  type: "message",
                },
              ],
            },
            {
              ...taskSnapshot.turns[0],
              id: "turn-skill-only",
              items: [
                {
                  id: "message-skill-only",
                  role: "user",
                  skills: [{ name: "git-commit" }],
                  text: "",
                  type: "message",
                },
              ],
            },
          ],
        },
      },
    });
  });
  await page.goto("/p/code-agent/t/task-1");

  const shortText = page.getByText("现在系统的 gh cli 是可以用的", { exact: true });
  const shortTextLineCount = await shortText.evaluate((element) => {
    const textNode = element.firstChild;
    if (!(textNode instanceof Text)) {
      throw new Error("Expected a short user message text node");
    }
    const range = document.createRange();
    range.selectNodeContents(textNode);
    return range.getClientRects().length;
  });
  expect(shortTextLineCount).toBe(1);

  const skillLabel = page.locator('[data-message-skill="git-commit"] > span');
  const skillOverflow = await skillLabel.evaluate(
    (element) => element.scrollWidth - element.clientWidth,
  );
  expect(skillOverflow).toBeLessThanOrEqual(0);
});

test("uses subtle hairline separation across registered routes", async ({ page }) => {
  const surfaces = [
    {
      path: "/p/code-agent",
      selector: "main header",
      border: "borderBottomWidth",
      offset: "0px 1px 0px 0px",
    },
  ] as const;

  for (const surface of surfaces) {
    await page.goto(surface.path);
    await page.locator("html").evaluate((root) => {
      root.setAttribute("data-theme", "light");
    });
    const styles = await page.locator(surface.selector).evaluate((element, border) => {
      const computed = getComputedStyle(element);
      return {
        borderWidth: computed[border],
        boxShadow: computed.boxShadow,
      };
    }, surface.border);

    expect(styles.borderWidth).toBe("0px");
    expect(styles.boxShadow).toContain("rgba(23, 23, 23, 0.06)");
    expect(styles.boxShadow).toContain(surface.offset);
  }
});

test("aligns the center toolbar with sidebar controls and inspector tabs", async ({ page }) => {
  await page.goto("/p/code-agent/t/task-1");

  const mainHeader = page.getByRole("main", { name: "任务时间线" }).locator(":scope > header");
  const leftTitle = page
    .getByRole("complementary", { name: "项目侧栏" })
    .getByRole("img", { name: "CodeAgent" });
  const centerTitle = page.getByRole("heading", { name: "构建 macOS 工作台", level: 1 });
  const rightTab = page
    .getByRole("complementary", { name: "运行环境" })
    .getByRole("tab", { name: "项目" });
  const search = page.getByRole("textbox", { name: "搜索任务" });
  const [mainHeaderBox, leftTitleBox, centerTitleBox, rightTabBox, searchBox] = await Promise.all([
    mainHeader.boundingBox(),
    leftTitle.boundingBox(),
    centerTitle.boundingBox(),
    rightTab.boundingBox(),
    search.boundingBox(),
  ]);

  expect(mainHeaderBox).not.toBeNull();
  expect(leftTitleBox).not.toBeNull();
  expect(centerTitleBox).not.toBeNull();
  expect(rightTabBox).not.toBeNull();
  expect(searchBox).not.toBeNull();
  if (
    mainHeaderBox === null ||
    leftTitleBox === null ||
    centerTitleBox === null ||
    rightTabBox === null ||
    searchBox === null
  ) {
    return;
  }

  // 三栏顶部主控件共用同一个垂直中心，避免文字和标签上下错位。
  const centerTitlePosition = centerTitleBox.y + centerTitleBox.height / 2;
  expect(leftTitleBox.y + leftTitleBox.height / 2).toBe(centerTitlePosition);
  expect(rightTabBox.y + rightTabBox.height / 2).toBe(centerTitlePosition);

  // 中栏分隔线与左栏第二层搜索控件顶部共用同一水平基线。
  const dividerPosition = mainHeaderBox.y + mainHeaderBox.height;
  expect(dividerPosition).toBe(searchBox.y);
});
