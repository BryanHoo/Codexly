import { expect, parseRequestRecord, test } from "./fixtures/app-shell.js";

test("设置控件沿卡片右边缘对齐并保持参考页面间距", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const panel = page.locator("#settings-panel-appearance");
  await expect(panel).toBeVisible();
  // 检查真实渲染边界，避免只验证类名却遗漏控件包装层导致的错位。
  const bounds = await panel.evaluate((element) => {
    const controls = [...element.querySelectorAll('select, [role="group"], [role="switch"]')];
    return {
      width: element.getBoundingClientRect().width,
      edges: controls.map((control) => control.getBoundingClientRect().right),
      heights: [...element.querySelectorAll("select")].map(
        (control) => control.getBoundingClientRect().height,
      ),
    };
  });
  expect(bounds.width).toBe(780);
  expect(Math.max(...bounds.edges) - Math.min(...bounds.edges)).toBeLessThanOrEqual(1);
  expect(bounds.heights.every((height) => height === 32)).toBe(true);
  for (const [name, file] of [
    ["宠物", "pets"],
    ["模型服务", "provider"],
    ["智能体配置", "agent"],
    ["关于", "about"],
  ] as const) {
    await page
      .getByRole("region", { name: "全局设置" })
      .getByRole("button", { name, exact: true })
      .click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await page.screenshot({ path: `.artifacts/settings-${file}-desktop.png` });
  }
});

test("搜索设置、保存个性化，并在删除记忆前确认 @smoke", async ({ page }) => {
  let content = "# 原始说明\n";
  let deletes = 0;
  let memory = { enabled: false, allowExternalContext: true };
  await page.route("**/v1/personalization/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/instructions")) {
      if (route.request().method() === "PUT") {
        const body = parseRequestRecord(route.request().postData());
        expect(body["expectedContent"]).toBe(content);
        content = String(body["content"]);
      }
      await route.fulfill({ json: { content, path: "/runtime/AGENTS.md", overrideActive: true } });
    } else if (path.endsWith("/reset")) {
      deletes++;
      await route.fulfill({ json: { success: true } });
    } else {
      if (route.request().method() === "PUT")
        memory = { ...memory, ...parseRequestRecord(route.request().postData()) };
      await route.fulfill({ json: memory });
    }
  });
  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("region", { name: "全局设置" });
  await expect(page.getByRole("main", { name: "任务时间线" })).toBeHidden();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("searchbox", { name: "搜索设置" }).fill("AGENTS.md");
  await settings.getByRole("button", { name: "个性化", exact: true }).click();
  await expect(settings.getByRole("button", { name: "常规", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(settings).toBeVisible();
  await settings.getByRole("textbox", { name: "Codex 说明" }).fill("# 新说明\n保留格式。\n");
  await settings.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => content).toBe("# 新说明\n保留格式。\n");
  await settings.getByRole("switch", { name: "启用本地记忆", exact: true }).click();
  await expect.poll(() => memory.enabled).toBe(true);
  await settings.getByRole("button", { name: "删除本地记忆", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "删除本地记忆" });
  await expect(confirmation).toBeVisible();
  expect(deletes).toBe(0);
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "删除本地记忆", exact: true }).click();
  await confirmation.getByRole("button", { name: "确认删除" }).click();
  await expect.poll(() => deletes).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await page.screenshot({ path: ".artifacts/settings-personalization-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await settings.getByRole("main").evaluate((element) => {
    element.scrollTo({ top: 0 });
  });
  await page.screenshot({
    path: ".artifacts/settings-personalization-desktop.png",
    fullPage: true,
  });
  await settings.getByRole("button", { name: "返回应用" }).click();
  await expect(page.getByRole("main", { name: "任务时间线" })).toBeVisible();
});

test("全局设置保存失败时保留草稿，重试后再返回", async ({ page }) => {
  let fail = true;
  await page.route("**/v1/settings", async (route) => {
    if (route.request().method() !== "PUT" || !fail) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 503,
      json: { code: "PROVIDER_ERROR", message: "Save unavailable", retryable: true },
    });
  });
  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("region", { name: "全局设置" });
  await settings.getByRole("button", { name: "引导", exact: true }).click();
  await expect(settings.getByRole("alert")).toContainText("草稿已保留");
  await settings.getByRole("button", { name: "返回应用" }).click();
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("button", { name: "引导", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fail = false;
  await settings.getByRole("button", { name: "重试", exact: true }).click();
  await expect(settings.getByRole("alert")).toHaveCount(0);
  await settings.getByRole("button", { name: "返回应用" }).click();
  await expect(page.getByRole("main", { name: "任务时间线" })).toBeVisible();
});

test("选择 Bing 历史壁纸并切回每日自动更新", async ({ page }) => {
  await page.route("**/v1/workbench-background/bing/catalog", (route) =>
    route.fulfill({
      json: [
        { day: "2026-09-10", title: "山谷", copyright: "Bing" },
        { day: "2026-09-09", title: "海岸", copyright: "Bing" },
      ],
    }),
  );
  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("region", { name: "全局设置" });
  await settings.getByRole("button", { name: "Bing 每日壁纸", exact: true }).click();
  await settings.getByRole("button", { name: "选择图片", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "选择图片", exact: true });
  await picker.getByRole("button", { name: "使用 2026-09-09", exact: true }).click();
  await expect(picker.getByRole("checkbox", { name: "每日自动更新" })).not.toBeChecked();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("codexly.workbench-background-preference")),
    )
    .toContain('"selectedBingDay":"2026-09-09"');
  await picker.getByRole("checkbox", { name: "每日自动更新" }).check();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("codexly.workbench-background-preference")),
    )
    .toContain('"selectedBingDay":null');
  await picker.getByRole("button", { name: "完成", exact: true }).click();
  await page.screenshot({ path: ".artifacts/settings-general-desktop.png", fullPage: true });
});
