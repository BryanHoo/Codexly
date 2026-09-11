import { expect, mockAppShellApi, parseRequestRecord, test } from "./fixtures/app-shell.js";
import { getComposerModelSelector } from "./app-shell-settings-navigation.test-support.js";

test.describe.configure({ mode: "serial" });

function parseCssAlpha(color: string): number {
  const alpha =
    /\/\s*([\d.]+)\s*\)$/u.exec(color)?.[1] ??
    /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/u.exec(color)?.[1];
  return alpha === undefined ? 1 : Number(alpha);
}

test("connects a custom API from the provider gate and reuses it in settings", async ({ page }) => {
  await mockAppShellApi(page, { providerConnected: false });
  await page.goto("/");

  await expect(page.getByRole("heading", { exact: true, name: "Codexly" })).toBeVisible();
  const officialModeButton = page.getByRole("button", { name: "官方登录" });
  const customModeButton = page.getByRole("button", { name: "自定义 API" });
  await expect(officialModeButton).toHaveCSS("align-items", "center");
  await expect(officialModeButton).toHaveCSS("justify-content", "center");
  await expect(customModeButton).toHaveCSS("align-items", "center");
  await expect(customModeButton).toHaveCSS("justify-content", "center");
  await customModeButton.click();
  await page.getByRole("textbox", { name: "API Base URL" }).fill("https://api.example.com/v1/");
  await page.getByLabel("API Key（可选）").fill("e2e-secret");
  await page.getByRole("button", { exact: true, name: "连接" }).click();

  await expect(page).toHaveURL(/\/p\/codexly$/u);
  await page.getByRole("button", { exact: true, name: "设置" }).click();
  const dialog = page.getByRole("region", { name: "全局设置" });
  await dialog.getByRole("button", { name: "模型服务" }).click();
  await expect(dialog.getByRole("textbox", { name: "API Base URL" })).toHaveValue(
    "https://api.example.com/v1",
  );
  await expect(dialog.getByLabel("API Key（可选）")).toHaveValue("");
  await expect(dialog.getByText("已连接", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "智能体配置" }).click();
  await dialog.getByRole("combobox", { name: "模型" }).selectOption("custom-coder");
  const reasoningSelect = dialog.getByRole("combobox", { name: "思考量" });
  await expect(reasoningSelect.locator("option")).toHaveText(["最低", "低", "中", "高", "极高"]);
  await reasoningSelect.selectOption("high");
  await expect(reasoningSelect).toHaveValue("high");
});

test("redirects the root route to the default project workbench @smoke", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("app-root")).toBeAttached();
  await expect(page).toHaveURL(/\/p\/codexly$/);
  await expect(page.getByRole("main", { name: "任务时间线" })).toBeVisible();
});

test("opens the requested settings section and aligns the sidebar footer with the branch row", async ({
  page,
}) => {
  await page.goto("/p/codexly/t/task-1");

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  const settingsTrigger = sidebar.getByRole("button", { exact: true, name: "设置" });
  const branchTrigger = page.getByRole("button", { name: /切换分支，当前分支/u });
  const [settingsTextBox, branchTextBox] = await Promise.all([
    settingsTrigger.getByText("设置", { exact: true }).boundingBox(),
    branchTrigger.getByText("feat/review-targets", { exact: true }).boundingBox(),
  ]);
  expect(settingsTextBox).not.toBeNull();
  expect(branchTextBox).not.toBeNull();
  if (settingsTextBox === null || branchTextBox === null) {
    throw new Error("设置或分支文字缺少布局边界");
  }
  expect(
    Math.abs(
      settingsTextBox.y + settingsTextBox.height / 2 - (branchTextBox.y + branchTextBox.height / 2),
    ),
  ).toBeLessThanOrEqual(1);

  await settingsTrigger.click();
  const dialog = page.getByRole("region", { name: "全局设置" });
  await expect(dialog.getByRole("button", { name: "常规" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await dialog.getByRole("button", { name: "返回应用" }).click();

  await sidebar.getByRole("button", { name: /关于，Codexly .*终端连接状态/u }).click();
  await expect(dialog.getByRole("button", { name: "关于" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("defaults appearance to automatic and follows the system color scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/p/codexly/t/task-1");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { exact: true, name: "设置" }).click();
  const dialog = page.getByRole("region", { name: "全局设置" });
  const automaticMode = dialog.getByRole("button", { name: "自动模式" });
  await expect(automaticMode).toHaveAttribute("aria-pressed", "true");

  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await dialog.getByRole("button", { name: "深色模式" }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await dialog.getByRole("button", { exact: true, name: "返回应用" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { exact: true, name: "设置" }).click();
  const reopenedDialog = page.getByRole("region", { name: "全局设置" });
  await reopenedDialog.getByRole("button", { name: "自动模式" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await reopenedDialog.getByRole("button", { exact: true, name: "返回应用" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.getByRole("button", { exact: true, name: "设置" }).click();
  const languageDialog = page.getByRole("region");
  await languageDialog.getByRole("combobox", { name: "语言" }).selectOption("en");
  await page.setViewportSize({ height: 844, width: 320 });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  for (const name of ["Automatic mode", "Light mode", "Dark mode"]) {
    await expect(languageDialog.getByRole("button", { name })).toBeVisible();
    expect(
      await languageDialog.getByRole("button", { name }).evaluate((button) => {
        return button.scrollWidth <= button.clientWidth;
      }),
    ).toBe(true);
  }
  await page.getByRole("button", { exact: true, name: "Back to app" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("applies and restores a custom workbench background", async ({ page }) => {
  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("button", { exact: true, name: "设置" }).click();
  const dialog = page.getByRole("region", { name: "全局设置" });
  await dialog.getByRole("button", { name: "自定义工作台背景" }).click();
  await dialog.getByRole("button", { name: "选择图片", exact: true }).click();
  await page
    .getByRole("dialog", { name: "选择图片", exact: true })
    .locator('input[type="file"]')
    .setInputFiles("docs/images/codexly-preview.png");
  await page
    .getByRole("dialog", { name: "选择图片", exact: true })
    .getByRole("button", { name: "完成", exact: true })
    .click();
  await dialog.getByRole("slider", { name: "壁纸遮罩不透明度" }).fill("35");
  // 设置页共用工作台背景，调整时无需退出页面即可看到图片和遮罩变化。
  const liveBackground = page.locator("[data-workbench-background]");
  await expect(liveBackground).toHaveAttribute("data-has-image", "true");
  await expect(dialog).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator('[data-workbench-background-overlay="true"]')).toHaveCSS(
    "opacity",
    "0.35",
  );
  const liveCanvas = page.locator('[data-workbench-background-canvas="true"]');
  const beforeBlur = await liveCanvas.evaluate((element) =>
    (element as HTMLCanvasElement).toDataURL(),
  );
  await dialog.getByRole("slider", { name: "背景模糊度" }).fill("65");
  await expect
    .poll(() => liveCanvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL()))
    .not.toBe(beforeBlur);
  await dialog.getByRole("button", { exact: true, name: "返回应用" }).click();

  const background = page.locator("[data-workbench-background]");
  await expect(background).toHaveAttribute("data-background-mode", "custom");
  await expect(background).toHaveAttribute("data-has-image", "true");
  const backgroundCanvas = page.locator('[data-workbench-background-canvas="true"]');
  await expect(backgroundCanvas).toHaveCSS("opacity", "1");
  const canvasSize = await backgroundCanvas.evaluate((element) => ({
    height: (element as HTMLCanvasElement).height,
    width: (element as HTMLCanvasElement).width,
  }));
  expect(canvasSize.height).toBeGreaterThan(0);
  expect(canvasSize.width).toBeGreaterThan(0);
  await expect(page.locator('[data-workbench-background-overlay="true"]')).toHaveCSS(
    "opacity",
    "0.35",
  );

  const transparentSurface = "rgba(0, 0, 0, 0)";
  await expect(page.locator(".workbench-sidebar")).toHaveCSS(
    "background-color",
    transparentSurface,
  );
  await expect(page.getByRole("main", { name: "任务时间线" })).toHaveCSS(
    "background-color",
    transparentSurface,
  );
  await expect(page.locator(".workbench-inspector")).toHaveCSS(
    "background-color",
    transparentSurface,
  );
  const composerBackgroundAlpha = parseCssAlpha(
    await page
      .locator("[data-prompt-input]")
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  );
  expect(composerBackgroundAlpha).toBeLessThanOrEqual(0.7);

  await page
    .getByRole("region", { name: /本次修改了 \d+ 个文件/u })
    .getByRole("button", { exact: true, name: "审核" })
    .click();
  const reviewDialog = page.getByRole("dialog");
  const reviewDialogBackgroundAlpha = parseCssAlpha(
    await reviewDialog.evaluate((element) => getComputedStyle(element).backgroundColor),
  );
  expect(reviewDialogBackgroundAlpha).toBeGreaterThanOrEqual(0.94);
  expect(reviewDialogBackgroundAlpha).toBeLessThanOrEqual(0.96);
  await expect(reviewDialog.getByRole("region", { name: "审核文件内容" })).toHaveCSS(
    "background-color",
    transparentSurface,
  );
  await expect(reviewDialog.getByRole("complementary", { name: "变更文件导航" })).toHaveCSS(
    "background-color",
    transparentSurface,
  );
  await reviewDialog.getByRole("button", { name: "关闭文件审核" }).click();

  await page.setViewportSize({ height: 844, width: 320 });
  await page.reload();
  await expect(background).toHaveAttribute("data-background-mode", "custom");
  await expect(background).toHaveAttribute("data-has-image", "true");
  await expect(backgroundCanvas).toHaveCSS("opacity", "1");
  const restoredPreference = await page.evaluate(() =>
    localStorage.getItem("codexly.workbench-background-preference"),
  );
  expect(restoredPreference).not.toBeNull();
  expect(await page.locator("body").evaluate((body) => body.scrollWidth <= body.clientWidth)).toBe(
    true,
  );

  await page.setViewportSize({ height: 720, width: 1280 });
  await page.getByRole("button", { name: "展开项目侧栏" }).click();
  await page.getByRole("button", { exact: true, name: "设置" }).click();
  const reopenedDialog = page.getByRole("region", { name: "全局设置" });
  const settingsDialogBackgroundAlpha = parseCssAlpha(
    await reopenedDialog.evaluate((element) => getComputedStyle(element).backgroundColor),
  );
  expect(settingsDialogBackgroundAlpha).toBe(0);
  await reopenedDialog.getByRole("button", { name: "自定义工作台背景" }).click();
  await reopenedDialog.getByRole("button", { name: "选择图片", exact: true }).click();
  await page
    .getByRole("dialog", { name: "选择图片", exact: true })
    .locator('input[type="file"]')
    .setInputFiles("docs/images/codexly-preview.png");
  await page
    .getByRole("dialog", { name: "选择图片", exact: true })
    .getByRole("button", { name: "完成", exact: true })
    .click();
  await reopenedDialog.getByRole("button", { exact: true, name: "返回应用" }).click();
  await expect(background).toHaveAttribute("data-has-image", "true");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("codexly.workbench-background-preference")),
    )
    .not.toBe(restoredPreference);
});

test("edits global defaults on a page without overriding task settings", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/p/codexly/t/task-1");
  const workbenchUrl = page.url();
  const taskModel = getComposerModelSelector(page);
  const taskApproval = page.getByRole("combobox", { name: "批准模式" });
  await expect(taskModel).toHaveAccessibleName("模型和思考量：GPT-5.6 Sol，高");
  await expect(taskApproval).toHaveValue("on-request");

  await page.getByRole("button", { exact: true, name: "设置" }).click();
  const dialog = page.getByRole("region", { name: "全局设置" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(workbenchUrl);
  await expect(dialog.getByRole("button", { name: "常规" })).toHaveCSS(
    "justify-content",
    "flex-start",
  );

  await dialog.getByRole("button", { name: "常规" }).click();
  await dialog.getByRole("button", { name: "深色模式" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await dialog.getByRole("button", { name: "引导", exact: true }).click();
  await dialog.getByRole("button", { name: "智能体配置" }).click();
  await dialog.getByRole("combobox", { name: "审批" }).selectOption("never");
  await dialog.getByRole("combobox", { name: "工作区" }).selectOption("danger-full-access");
  await dialog.getByRole("combobox", { name: "模型" }).selectOption("gpt-5.6-terra");
  await expect(dialog.getByRole("combobox", { name: "思考" })).toHaveValue("medium");
  await dialog.getByRole("button", { name: "个性化" }).click();
  await dialog.getByRole("combobox", { name: "提交模型" }).selectOption("gpt-5.6-terra");
  await expect(dialog.getByRole("combobox", { name: "提交思考量" })).toHaveCount(0);
  await dialog.getByRole("textbox", { name: "提交提示词" }).fill("突出用户可见影响。");
  await dialog.getByRole("button", { name: "常规" }).click();
  await dialog.getByRole("combobox", { name: "默认打开方式" }).selectOption("finder");
  await dialog.getByRole("button", { exact: true, name: "返回应用" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page).toHaveURL(workbenchUrl);
  await expect(taskModel).toHaveAccessibleName("模型和思考量：GPT-5.6 Sol，高");
  await expect(taskApproval).toHaveValue("on-request");

  await page.getByRole("button", { exact: true, name: "设置" }).click();
  const reopenedDialog = page.getByRole("region", { name: "全局设置" });
  await reopenedDialog.getByRole("button", { name: "常规" }).click();
  await expect(reopenedDialog.getByRole("button", { name: "深色模式" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await reopenedDialog.getByRole("button", { name: "智能体配置" }).click();
  await expect(reopenedDialog.getByRole("combobox", { name: "审批" })).toHaveValue("never");
  await expect(reopenedDialog.getByRole("combobox", { name: "工作区" })).toHaveValue(
    "danger-full-access",
  );
  await expect(reopenedDialog.getByRole("combobox", { name: "模型" })).toHaveValue("gpt-5.6-terra");
  await reopenedDialog.getByRole("button", { name: "个性化" }).click();
  await expect(reopenedDialog.getByRole("combobox", { name: "提交模型" })).toHaveValue(
    "gpt-5.6-terra",
  );
  await expect(reopenedDialog.getByRole("combobox", { name: "提交思考量" })).toHaveCount(0);
  await expect(reopenedDialog.getByRole("textbox", { name: "提交提示词" })).toHaveValue(
    "突出用户可见影响。",
  );
  await reopenedDialog.getByRole("button", { name: "常规" }).click();
  await expect(reopenedDialog.getByRole("combobox", { name: "默认打开方式" })).toHaveValue(
    "finder",
  );

  await page.setViewportSize({ height: 844, width: 390 });
  const dialogBounds = await reopenedDialog.boundingBox();
  expect(dialogBounds).not.toBeNull();
  expect(dialogBounds?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect(dialogBounds?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((dialogBounds?.x ?? 0) + (dialogBounds?.width ?? 0)).toBeLessThanOrEqual(390);
  expect((dialogBounds?.y ?? 0) + (dialogBounds?.height ?? 0)).toBeLessThanOrEqual(844);
  expect(
    await reopenedDialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});

test("automatically saves browser preferences", async ({ page }) => {
  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("button", { exact: true, name: "设置" }).click();
  await page.getByRole("combobox", { name: "语言" }).selectOption("en");
  await page.getByRole("switch", { name: "Task notifications" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "Back to app" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { exact: true, name: "Settings" }).click();
  await expect(page.getByRole("switch", { name: "Task notifications" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await page.getByRole("button", { name: "Agent configuration" }).click();
  await expect(page.getByRole("combobox", { name: "Reasoning effort" })).toBeVisible();
  await page.getByRole("button", { name: "Back to app" }).click();
  await expect(page.locator("h1").filter({ hasText: "构建 macOS 工作台" })).toBeVisible();
});

test("opens About from the sidebar and installs an available update", async ({ page }) => {
  let appInfoRequests = 0;
  let updateRequest: Record<string, unknown> | undefined;
  await page.route("**/v1/app-info", async (route) => {
    appInfoRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      json: {
        appVersion: "1.3.0",
        codexVersion: "0.154.0",
        latestVersion: "1.4.0",
        releaseNotes: "### 新增\n\n- 添加更新日志查看入口。",
        status: "available",
        updateAvailable: true,
      },
    });
  });
  await page.route("**/v1/app-update", async (route) => {
    updateRequest = parseRequestRecord(route.request().postData());
    await route.fulfill({
      contentType: "application/json",
      json: {
        appVersion: "1.3.0",
        codexVersion: "0.154.0",
        latestVersion: "1.4.0",
        releaseNotes: null,
        status: "restart-required",
        updateAvailable: false,
      },
    });
  });
  await page.goto("/p/codexly/t/task-1");

  const settingsButton = page.getByRole("button", {
    name: /关于，Codexly 1\.3\.0，有可用更新，终端连接状态：在线/u,
  });
  await expect(settingsButton.locator(".text-warning")).toContainText("v1.3.0");
  await expect(settingsButton.locator(".lucide-circle-arrow-up")).toBeVisible();
  await settingsButton.click();

  const dialog = page.getByRole("region", { name: "全局设置" });
  await expect(dialog.getByRole("button", { name: "关于" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(dialog.getByText("1.3.0", { exact: true })).toBeVisible();
  await expect(dialog.getByText("0.154.0", { exact: true })).toBeVisible();
  const githubLink = dialog.getByRole("link", { name: "BryanHoo/Codexly" });
  await expect(githubLink).toHaveAttribute("href", "https://github.com/BryanHoo/Codexly");
  await expect(githubLink).toHaveAttribute("target", "_blank");

  // 独立设置页的值与链接统一贴齐卡片右边缘。
  const [versionBox, githubBox] = await Promise.all([
    dialog.getByText("1.3.0", { exact: true }).boundingBox(),
    githubLink.boundingBox(),
  ]);
  expect(versionBox).not.toBeNull();
  expect(githubBox).not.toBeNull();
  if (versionBox === null || githubBox === null) throw new Error("关于字段缺少布局边界");
  expect(
    Math.abs(versionBox.x + versionBox.width - githubBox.x - githubBox.width),
  ).toBeLessThanOrEqual(1);

  // 参考页面的值列允许操作换行，但不能溢出卡片。
  const updateControlRightEdges = await Promise.all(
    [
      dialog.getByText("发现新版本 1.4.0", { exact: true }),
      dialog.getByRole("button", { name: "检查更新" }),
      dialog.getByRole("button", { name: "更新日志" }),
      dialog.getByRole("button", { name: "更新到 1.4.0" }),
    ].map(async (control) => {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      if (box === null) throw new Error("更新操作控件缺少布局边界");
      return box.x + box.width;
    }),
  );
  expect(Math.max(...updateControlRightEdges)).toBeLessThanOrEqual(
    versionBox.x + versionBox.width + 1,
  );

  const initialAppInfoRequests = appInfoRequests;
  await dialog.getByRole("button", { name: "检查更新" }).click();
  await expect.poll(() => appInfoRequests).toBeGreaterThan(initialAppInfoRequests);

  await dialog.getByRole("button", { name: "更新日志" }).click();
  const releaseNotesDialog = page.getByRole("dialog", { name: "1.4.0 更新日志" });
  await expect(
    releaseNotesDialog.getByText("添加更新日志查看入口。", { exact: true }),
  ).toBeVisible();
  await releaseNotesDialog.getByRole("button", { name: "关闭更新日志" }).click();
  await expect(releaseNotesDialog).toHaveCount(0);

  await dialog.getByRole("button", { name: "更新到 1.4.0" }).click();

  await expect.poll(() => updateRequest).toEqual({ version: "1.4.0" });
  await expect(dialog.getByText("更新完成，重启 Codexly 后生效")).toBeVisible();
});
