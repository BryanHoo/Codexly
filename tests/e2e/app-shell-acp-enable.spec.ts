import { expect, test } from "./fixtures/app-shell.js";

for (const width of [390, 1280]) {
  test(`ACP 设置启用另一引擎保留旧版选择 ${String(width)}px @cross-browser`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const marker = JSON.stringify({ engines: ["codex"], complete: true });
    await page.addInitScript((old) => {
      localStorage.setItem("codeagent:engine-setup:v1", old);
    }, marker);
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
    let inspections = 0;
    await page.route("**/v1/acp/agents/claude", (route) => {
      inspections += 1;
      return inspections === 1
        ? route.fulfill({
            status: 502,
            json: { code: "PROVIDER_ERROR", message: "offline", retryable: false },
          })
        : route.fulfill({
            json: {
              engine: "claude",
              protocolVersion: 1,
              authMethods: [{ id: "native-login", name: "原生登录" }],
            },
          });
    });
    const legacy: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path.includes("/engines/claude") || path.includes("/claude/settings")) legacy.push(path);
    });
    await page.goto("/p/codexly");
    if (width < 600) await page.getByRole("button", { name: "展开项目侧栏", exact: true }).click();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("region", { name: "全局设置" });
    await settings.getByRole("button", { name: "ACP", exact: true }).click();
    await settings.getByRole("button", { name: /Claude Code/ }).click();
    const enable = settings.getByRole("button", { name: "启用 Claude", exact: true });
    await expect(enable).toBeEnabled();
    expect(inspections).toBe(0);
    await enable.click();
    await expect(settings.getByRole("alert")).toHaveText(/准备失败/u);
    expect(await page.evaluate(() => localStorage.getItem("codeagent:engine-setup:v1"))).toBe(
      marker,
    );
    await settings.getByRole("button", { name: "重试", exact: true }).click();
    await expect(
      settings.getByRole("button", { name: "在浏览器中登录", exact: true }),
    ).toBeEnabled();
    expect(inspections).toBe(2);
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("codexly:acp-engine-setup:v1") ?? "null") as unknown,
      ),
    ).toEqual({ engines: ["codex", "claude"], complete: true });
    expect(await page.evaluate(() => localStorage.getItem("codeagent:engine-setup:v1"))).toBe(
      marker,
    );
    expect(legacy).toEqual([]);
  });
}
