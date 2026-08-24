import {
  expect,
  parseProjectOrderRequest,
  parseRequestRecord,
  test,
} from "./fixtures/app-shell.js";
import { getComposerModelSelector } from "./app-shell-settings-navigation.test-support.js";

test.describe.configure({ mode: "serial" });

test("uses global defaults throughout a new task composer", async ({ page }) => {
  await page.route("**/v1/settings", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        settings: {
          approvalPolicy: "never",
          approvalsReviewer: "user",
          commitMessageModel: "gpt-5.6-sol",
          commitMessagePrompt: "",
          defaultOpenAppId: "finder",
          fastMode: false,
          followUpBehavior: "queue",
          model: "gpt-5.6-terra",
          reasoningEffort: "medium",
          sandboxMode: "danger-full-access",
        },
      },
    });
  });
  await page.route("**/v1/projects/codexly/defaults", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        settings: {
          approvalPolicy: "never",
          approvalsReviewer: "user",
          fastMode: false,
          model: "gpt-5.6-terra",
          reasoningEffort: "medium",
          sandboxMode: "danger-full-access",
        },
      },
    });
  });

  await page.goto("/p/codexly");

  await expect(page.getByRole("combobox", { name: "批准模式" })).toHaveValue("never");
  await expect(page.getByRole("combobox", { name: "沙盒模式" })).toHaveValue("danger-full-access");
  await expect(getComposerModelSelector(page)).toHaveAccessibleName(
    "模型和思考量：GPT-5.6 Terra，中",
  );
  await expect(page.getByRole("button", { name: "在 Finder 中打开" })).toBeVisible();
});

test("opens the project from the center toolbar quick action", async ({ page }) => {
  const openRequests: Record<string, unknown>[] = [];
  await page.route("**/v1/projects/codexly/open?*", async (route) => {
    openRequests.push(parseRequestRecord(route.request().postData()));
    await route.fallback();
  });
  await page.goto("/p/codexly/t/task-1");

  const mainHeader = page.getByRole("main", { name: "任务时间线" }).locator(":scope > header");
  const quickOpenButton = mainHeader.getByRole("button", { name: "在 Zed 中打开" });
  const quickOpenMenuButton = mainHeader.getByRole("button", { name: "选择打开方式" });
  await expect(quickOpenButton).toBeVisible();
  await expect(quickOpenButton).toHaveCSS("height", "24px");
  await expect(quickOpenButton.locator("svg")).toHaveCSS("width", "14px");
  await expect(quickOpenMenuButton).toHaveCSS("height", "24px");
  await expect(quickOpenMenuButton).toHaveCSS("width", "24px");
  await quickOpenButton.click();
  await expect.poll(() => openRequests).toEqual([{ appId: "zed" }]);
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);

  await quickOpenMenuButton.click();
  const openMenu = page.getByRole("menu", { name: "选择打开方式" });
  await expect(openMenu).toBeVisible();
  const finderMenuItem = openMenu.getByRole("menuitem", { name: "Finder" });
  await expect(finderMenuItem.locator("svg")).toHaveCSS("width", "16px");
  await expect(finderMenuItem.locator("svg")).toHaveCSS("height", "16px");
  await finderMenuItem.click();
  await expect.poll(() => openRequests).toEqual([{ appId: "zed" }, { appId: "finder" }]);
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(quickOpenButton).toBeHidden();
  await expect(quickOpenMenuButton).toBeHidden();
  const viewportMetrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(viewportMetrics.documentWidth).toBeLessThanOrEqual(viewportMetrics.viewportWidth);
});

test("restores the project folder expansion preference after reload", async ({ page }) => {
  await page.goto("/p/codexly");

  const firstProject = page.getByRole("button", { name: "切换项目 Codexly" });
  const secondProject = page.getByRole("button", { name: "切换项目 superwork" });
  await expect(firstProject).toHaveAttribute("aria-expanded", "true");
  await expect(secondProject).toHaveAttribute("aria-expanded", "false");

  await firstProject.click();
  await secondProject.click();
  await expect(page).toHaveURL(/\/p\/codexly$/u);
  await expect(firstProject).toHaveAttribute("aria-expanded", "false");
  await expect(secondProject).toHaveAttribute("aria-expanded", "true");

  await page.reload();

  await expect(firstProject).toHaveAttribute("aria-expanded", "false");
  await expect(secondProject).toHaveAttribute("aria-expanded", "true");

  await page.goto("/");

  await expect(page).toHaveURL(/\/p\/superwork$/u);
  await expect(page.getByRole("main", { name: "任务时间线" })).toBeVisible();
});

test("provides reusable design tokens for light and dark themes", async ({ page }) => {
  await page.goto("/p/codexly");
  const readTheme = async (theme: "dark" | "light") =>
    page.locator("html").evaluate((root, activeTheme) => {
      root.setAttribute("data-theme", activeTheme);

      // 通过真实 CSS 解析值校验主题，而不是绑定变量的文本写法。
      const resolveColor = (token: string) => {
        const probe = document.createElement("span");
        probe.style.color = `var(${token})`;
        root.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      };
      const inlineCode = document.createElement("code");
      inlineCode.dataset["streamdown"] = "inline-code";
      root.append(inlineCode);
      const inlineCodeBackground = getComputedStyle(inlineCode).backgroundColor;
      inlineCode.remove();
      const styles = getComputedStyle(root);

      return {
        accent: resolveColor("--ui-color-accent"),
        bodyFontWeight: getComputedStyle(document.body).fontWeight,
        bodyFontSize: styles.getPropertyValue("--ui-font-size-body").trim(),
        content: resolveColor("--ui-color-content"),
        control: resolveColor("--ui-color-control"),
        diffAdded: resolveColor("--ui-color-diff-added"),
        diffRemoved: resolveColor("--ui-color-diff-removed"),
        ink: resolveColor("--ui-color-text"),
        inlineCodeBackground,
        mutedInk: resolveColor("--ui-color-text-muted"),
        panel: resolveColor("--ui-color-panel"),
        sidebar: resolveColor("--ui-color-sidebar"),
        semanticControlHover: resolveColor("--color-control-hover"),
        semanticBrand: resolveColor("--color-brand"),
        spaceUnit: styles.getPropertyValue("--ui-space-unit").trim(),
        subtleInk: resolveColor("--ui-color-text-subtle"),
        surface: styles.backgroundColor,
      };
    }, theme);

  expect(await readTheme("light")).toEqual({
    accent: "rgb(0, 106, 255)",
    bodyFontWeight: "450",
    bodyFontSize: expect.stringMatching(/^0?\.875rem$/),
    content: "rgb(255, 255, 255)",
    control: "rgba(17, 17, 17, 0.04)",
    diffAdded: "rgb(40, 169, 72)",
    diffRemoved: "rgb(235, 0, 29)",
    ink: "rgb(17, 17, 17)",
    inlineCodeBackground: "rgba(17, 17, 17, 0.08)",
    mutedInk: "rgba(17, 17, 17, 0.72)",
    panel: "rgb(255, 255, 255)",
    sidebar: "rgb(255, 255, 255)",
    semanticControlHover: "rgba(23, 23, 23, 0.075)",
    semanticBrand: "rgb(0, 106, 255)",
    spaceUnit: expect.stringMatching(/^0?\.25rem$/),
    subtleInk: "rgba(17, 17, 17, 0.52)",
    surface: "rgb(255, 255, 255)",
  });

  expect(await readTheme("dark")).toEqual({
    accent: "rgb(51, 156, 255)",
    bodyFontWeight: "450",
    bodyFontSize: expect.stringMatching(/^0?\.875rem$/),
    content: "rgb(24, 24, 24)",
    control: "rgba(255, 255, 255, 0.07)",
    diffAdded: "rgb(64, 201, 119)",
    diffRemoved: "rgb(250, 66, 62)",
    ink: "rgb(255, 255, 255)",
    inlineCodeBackground: "rgba(255, 255, 255, 0.12)",
    mutedInk: "rgba(255, 255, 255, 0.68)",
    panel: "rgb(24, 24, 24)",
    sidebar: "rgb(24, 24, 24)",
    semanticControlHover: "rgba(255, 255, 255, 0.1)",
    semanticBrand: "rgb(51, 156, 255)",
    spaceUnit: expect.stringMatching(/^0?\.25rem$/),
    subtleInk: "rgba(255, 255, 255, 0.5)",
    surface: "rgb(24, 24, 24)",
  });
});

test("exposes the documented navigation routes", async ({ page }) => {
  const routes = [
    { path: "/p/codexly", heading: "Codexly" },
    { path: "/p/codexly/t/task-1", heading: "构建 macOS 工作台" },
  ];

  for (const route of routes) {
    await page.goto(route.path);
    await expect(
      page.getByRole("main").getByRole("heading", { name: route.heading }),
    ).toBeVisible();
  }
});

test("keeps the current task open when the product logo is clicked", async ({ page }) => {
  await page.goto("/p/codexly/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  await sidebar.getByText("Codexly", { exact: true }).first().click();

  await expect(page).toHaveURL(/\/p\/codexly\/t\/task-1$/);
});

test("drags project folders to reorder and restores the persisted order @cross-browser", async ({
  page,
}) => {
  await page.goto("/p/codexly");
  const codexlyProject = page.getByRole("button", { name: "切换项目 Codexly" });
  const superworkProject = page.getByRole("button", { name: "切换项目 superwork" });
  await codexlyProject.click();

  const codexlyBounds = await codexlyProject.boundingBox();
  const superworkBounds = await superworkProject.boundingBox();
  if (codexlyBounds === null || superworkBounds === null) {
    throw new Error("Project rows are not visible");
  }
  const reorderRequest = page.waitForRequest(
    (request) => request.url().endsWith("/v1/projects/order") && request.method() === "PUT",
  );
  await page.mouse.move(
    codexlyBounds.x + codexlyBounds.width / 2,
    codexlyBounds.y + codexlyBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    codexlyBounds.x + codexlyBounds.width / 2 + 12,
    codexlyBounds.y + codexlyBounds.height / 2,
  );
  await expect(codexlyProject.locator("xpath=..").locator("xpath=..")).toHaveAttribute(
    "data-project-reordering",
    "true",
  );
  await page.mouse.move(
    superworkBounds.x + superworkBounds.width / 2,
    superworkBounds.y + superworkBounds.height * 0.75,
    { steps: 4 },
  );
  await page.mouse.up();

  expect(parseProjectOrderRequest((await reorderRequest).postData())).toEqual([
    "superwork",
    "codexly",
  ]);
  await expect
    .poll(() =>
      page
        .locator("[data-project-reorder-id]")
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute("data-project-reorder-id")),
        ),
    )
    .toEqual(["superwork", "codexly"]);

  await page.reload();
  await expect
    .poll(() =>
      page
        .locator("[data-project-reorder-id]")
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute("data-project-reorder-id")),
        ),
    )
    .toEqual(["superwork", "codexly"]);

  const keyboardRequest = page.waitForRequest(
    (request) => request.url().endsWith("/v1/projects/order") && request.method() === "PUT",
  );
  await page.getByRole("button", { name: "切换项目 Codexly" }).press("Alt+ArrowUp");
  expect(parseProjectOrderRequest((await keyboardRequest).postData())).toEqual([
    "codexly",
    "superwork",
  ]);
});
