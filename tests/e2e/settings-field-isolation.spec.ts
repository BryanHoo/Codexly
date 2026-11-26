import { expect, parseRequestRecord, test } from "./fixtures/app-shell.js";

test("ACP 保存期间阻止并发覆盖，完整回执保留兄弟选项", async ({ page }) => {
  const writes: Record<string, unknown>[] = [];
  const pending = Promise.withResolvers<undefined>();
  await page.route("**/v1/acp/agents/codex/defaults", async (route) => {
    if (route.request().method() === "PATCH") {
      writes.push(parseRequestRecord(route.request().postData()));
      if (writes.length === 1) await pending.promise;
    }
    await route.fallback();
  });
  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const region = page.getByRole("region", { name: "全局设置" });
  await region.getByRole("button", { name: "ACP", exact: true }).click();
  const heading = region.getByRole("heading", { name: "会话默认配置", exact: true });
  const search = region.getByRole("combobox", { name: "网页搜索", exact: true });
  const verbosity = region.getByRole("combobox", { name: "输出详细程度", exact: true });
  await expect(search).toBeEnabled();
  const sibling = await verbosity.elementHandle();
  try {
    await search.click();
    await page.getByRole("option", { name: /^(live|实时)$/iu }).click();
    await heading.click();
    await expect.poll(() => writes.length).toBe(1);
    await expect(verbosity).toBeDisabled();
    await expect(verbosity).toHaveText("默认");
    expect(await sibling.evaluate((element) => element.isConnected)).toBe(true);
  } finally {
    pending.resolve(undefined);
  }
  await expect(search).toBeEnabled();
  await expect(search).toHaveText(/live|实时/iu);
  await verbosity.click();
  await page.getByRole("option", { name: /^(high|高)$/iu }).click();
  await heading.click();
  await expect
    .poll(() => writes)
    .toEqual([
      { configId: "webSearch", value: "live" },
      { configId: "verbosity", value: "high" },
    ]);
  await expect(search).toHaveText(/live|实时/iu);
});

test("ACP 保存失败保留当前草稿和其他配置，支持重试", async ({ page }) => {
  const value = "live";
  let writes = 0;
  await page.route("**/v1/acp/agents/codex/defaults", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    expect(parseRequestRecord(route.request().postData())).toEqual({
      configId: "webSearch",
      value,
    });
    if (++writes > 1) return route.fallback();
    await route.fulfill({
      status: 503,
      json: { code: "PROVIDER_ERROR", message: "Save failed", retryable: true },
    });
  });
  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const region = page.getByRole("region", { name: "全局设置" });
  await region.getByRole("button", { name: "ACP", exact: true }).click();
  const search = region.getByRole("combobox", { name: "网页搜索", exact: true });
  const verbosity = region.getByRole("combobox", { name: "输出详细程度", exact: true });
  await expect(search).toHaveText(/cached|缓存/iu);
  const sibling = await verbosity.elementHandle();
  await search.click();
  await page.getByRole("option", { name: /^(live|实时)$/iu }).click();
  await region.getByRole("heading", { name: "会话默认配置", exact: true }).click();
  const error = region.getByRole("alert");
  await expect(error).toHaveText(/设置保存失败/u);
  await expect(search).toHaveText(/live|实时/iu);
  await expect(verbosity).toBeEnabled();
  await expect(verbosity).toHaveText("默认");
  expect(await sibling.evaluate((element) => element.isConnected)).toBe(true);
  await error.getByRole("button", { name: "重试", exact: true }).click();
  await expect(error).toHaveCount(0);
  expect(writes).toBe(2);
  await expect(search).toHaveText(/live|实时/iu);
});
