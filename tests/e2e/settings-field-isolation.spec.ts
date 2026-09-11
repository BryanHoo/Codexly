import { expect, parseRequestRecord, test } from "./fixtures/app-shell.js";

test("智能体选项独立更新，排队保存不会覆盖另一项", async ({ page }) => {
  let settings = { webSearch: "cached", modelVerbosity: null as string | null };
  const writes: Record<string, unknown>[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/v1/personalization/agent", async (route) => {
    if (route.request().method() === "PUT") {
      const input = parseRequestRecord(route.request().postData());
      writes.push(input);
      if (writes.length === 1) await pending;
      settings = { ...settings, ...input };
    }
    await route.fulfill({ json: settings });
  });
  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const region = page.getByRole("region", { name: "全局设置" });
  await region.getByRole("button", { name: "智能体配置", exact: true }).click();
  const search = region.getByRole("combobox", { name: "网页搜索", exact: true });
  const verbosity = region.getByRole("combobox", { name: "输出详细程度", exact: true });
  await expect(search).toBeEnabled();
  const sibling = await verbosity.elementHandle();
  try {
    await search.selectOption("live");
    await expect.poll(() => writes.length).toBe(1);
    await expect(verbosity).toBeEnabled();
    await expect(verbosity).toHaveValue("");
    await expect(search).toHaveValue("live");
    expect(await sibling?.evaluate((element) => element.isConnected)).toBe(true);
    await verbosity.selectOption("high");
    await expect(verbosity).toHaveValue("high");
  } finally {
    release();
  }
  await expect.poll(() => writes.length).toBe(2);
  await expect(search).toBeEnabled();
  await expect(verbosity).toBeEnabled();
  expect(writes[1]).toEqual({ webSearch: "live", modelVerbosity: "high" });
  await expect(search).toHaveValue("live");
  await expect(verbosity).toHaveValue("high");
});

test("记忆开关保存期间不改变其他开关和删除按钮，失败仅回退当前项", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  await page.route("**/v1/personalization/memories", async (route) => {
    if (route.request().method() === "PUT") {
      started = true;
      await pending;
      await route.fulfill({
        status: 503,
        json: { code: "PROVIDER_ERROR", message: "Save failed", retryable: true },
      });
    } else await route.fulfill({ json: { enabled: false, allowExternalContext: true } });
  });
  await page.route("**/v1/personalization/instructions", (route) =>
    route.fulfill({ json: { content: "", path: "/runtime/AGENTS.md", overrideActive: false } }),
  );
  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const region = page.getByRole("region", { name: "全局设置" });
  await region.getByRole("button", { name: "个性化", exact: true }).click();
  const enabled = region.getByRole("switch", { name: "启用本地记忆", exact: true });
  const external = region.getByRole("switch").nth(1);
  const remove = region.getByRole("button", { name: "删除本地记忆", exact: true });
  await expect(enabled).toBeEnabled();
  const sibling = await external.elementHandle();
  try {
    await enabled.click();
    await expect.poll(() => started).toBe(true);
    await expect(external).toBeEnabled();
    await expect(remove).toBeEnabled();
    await expect(enabled).toHaveAttribute("aria-checked", "true");
    await expect(external).toHaveAttribute("aria-checked", "true");
  } finally {
    release();
  }
  await expect(enabled).toBeEnabled();
  await expect(enabled).toHaveAttribute("aria-checked", "false");
  await expect(external).toHaveAttribute("aria-checked", "true");
  expect(await sibling?.evaluate((element) => element.isConnected)).toBe(true);
});
