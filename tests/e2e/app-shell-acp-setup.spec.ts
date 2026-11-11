import { expect, test } from "./fixtures/app-shell.js";

for (const width of [390, 1280]) {
  test(`ACP 首次连接检查、失败恢复与完成标记隔离 ${String(width)}px @cross-browser`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const old = JSON.stringify({ engines: ["claude"], complete: false });
    await page.addInitScript((marker) => {
      if (!localStorage.getItem("codeagent:engine-setup:v1"))
        localStorage.setItem("codeagent:engine-setup:v1", marker);
    }, old);
    await page.route("**/v1/capabilities", (route) =>
      route.fulfill({
        json: {
          runtime: "acp",
          provider: "codex",
          feedback: { upload: false },
          goals: { clear: false, read: false, update: false },
          skills: { list: false, use: false },
          tasks: { fork: false, list: true, read: true, start: true },
          turns: { compact: false, interrupt: true, review: false, start: true, steer: false },
        },
      }),
    );
    const inspections: string[] = [];
    await page.route("**/v1/acp/agents/codex", (route) => {
      inspections.push(route.request().url());
      return route.fulfill({ json: { engine: "codex", protocolVersion: 1, authMethods: [] } });
    });
    let checks = 0;
    await page.route("**/v1/acp/agents/codex/defaults", (route) => {
      checks += 1;
      return checks === 1
        ? route.fulfill({
            status: 502,
            json: { code: "PROVIDER_ERROR", message: "auth_required", retryable: false },
          })
        : route.fulfill({
            json: { configOptions: [], defaults: {}, unmappedLegacy: [], invalidDefaults: [] },
          });
    });
    await page.goto("/p/codexly");
    await expect(page.getByRole("heading", { name: "选择编程助手", exact: true })).toBeVisible();
    expect(inspections).toHaveLength(0);
    await page.getByRole("button", { name: "Codex OpenAI", exact: true }).click();
    await page.getByRole("button", { name: "继续", exact: true }).click();
    const finish = page.getByRole("button", { name: "连接并开始使用", exact: true });
    await expect(finish).toBeEnabled();
    expect(checks).toBe(0);
    await finish.click();
    await expect(page.getByRole("alert")).toHaveText(/未连接/u);
    await finish.click();
    await expect(page.getByRole("textbox", { name: "任务输入", exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("codeagent:engine-setup:v1"))).toBe(old);
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("codexly:acp-engine-setup:v1") ?? "null") as unknown,
      ),
    ).toEqual({ engines: ["codex"], complete: true });
    const previous = inspections.length;
    await page.reload();
    await expect(page.getByRole("textbox", { name: "任务输入", exact: true })).toBeVisible();
    expect(inspections.length).toBe(previous);
    expect(checks).toBe(2);
  });
}
