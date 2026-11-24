import { createAcpCapabilities } from "../../packages/protocol/src/acp-capabilities.js";
import { mockAcpWorkspace } from "./fixtures/acp-defaults.js";
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
  for (const [name, heading, file] of [
    ["宠物", "宠物", "pets"],
    ["ACP", "连接配置", "acp"],
    ["关于", "关于", "about"],
  ] as const) {
    const settings = page.getByRole("region", { name: "全局设置" });
    await settings.getByRole("button", { name, exact: true }).click();
    await expect(settings.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await page.screenshot({ path: `.artifacts/settings-${file}-desktop.png` });
  }
});

test("搜索全局指令并确认覆盖目标文件 @smoke", async ({ page }) => {
  await mockAcpWorkspace(page);
  const preferences = {
    defaultAgent: "codex",
    defaultModel: null,
    commitMessagePrompt: "",
    taskTitlePrompt: "",
    promptOptimizationPrompt: "",
    defaultOpenAppId: null,
    followUpBehavior: "queue",
    pet: { enabled: false, selectedPetId: null },
    globalInstructions: "# 原始说明\n",
  };
  const version = "a".repeat(64);
  const writes: Record<string, unknown>[] = [];
  await page.route("**/v1/capabilities", (route) =>
    route.fulfill({ json: createAcpCapabilities("codex") }),
  );
  await page.route("**/v1/application-preferences", (route) =>
    route.fulfill({ json: preferences }),
  );
  await page.route("**/v1/application-preferences/instructions/targets", (route) =>
    route.fulfill({
      json: {
        version,
        files: [{ agents: ["Codex"], path: "/runtime/AGENTS.md", exists: true }],
        unsupported: [],
      },
    }),
  );
  await page.route("**/v1/application-preferences/instructions", (route) => {
    const input = parseRequestRecord(route.request().postData());
    writes.push(input);
    preferences.globalInstructions = String(input["content"]);
    return route.fulfill({ json: preferences });
  });
  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "全局设置", exact: true });
  const search = settings.getByRole("searchbox", { name: "搜索设置" });
  await search.fill("全局指令");
  await expect(search).toHaveValue("全局指令");
  await settings.getByRole("button", { name: "全局指令", exact: true }).click();
  await expect(settings.getByRole("button", { name: "常规", exact: true })).toHaveCount(0);
  const editor = settings.getByRole("textbox", { name: "全局指令", exact: true });
  await expect(editor).toHaveValue("# 原始说明\n");
  const content = "# 新说明\n保留格式。\n";
  await editor.fill(content);
  const save = settings.getByRole("button", { name: "保存", exact: true });
  await save.click();
  const confirmation = page.getByRole("dialog", { name: "确认保存全局指令" });
  await expect(confirmation.getByText("/runtime/AGENTS.md", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(editor).toHaveValue(content);
  expect(writes).toEqual([]);
  await save.click();
  await confirmation.getByRole("button", { name: "确认保存", exact: true }).click();
  await expect.poll(() => writes).toEqual([{ content, version }]);
  await expect(page.getByText("全局指令已保存", { exact: true })).toBeVisible();
  await expect(settings.getByRole("switch", { name: "启用本地记忆", exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await settings.getByRole("button", { name: "关闭", exact: true }).click();
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
  const saveError = page.locator('[data-slot="toast"]').filter({ hasText: "保存失败，请重试" });
  await expect(saveError).toBeVisible();
  await page
    .getByRole("dialog", { name: "全局设置", exact: true })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("button", { name: "引导", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fail = false;
  await saveError.getByRole("button", { name: "重试", exact: true }).click();
  await expect(saveError).toHaveCount(0);
  await page
    .getByRole("dialog", { name: "全局设置", exact: true })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
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
