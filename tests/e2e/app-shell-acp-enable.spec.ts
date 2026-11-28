import { expect, test } from "./fixtures/app-shell.js";
import { installedAcpCodex, mockAcpWorkspace } from "./fixtures/acp-defaults.js";

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
    const claude = {
      ...installedAcpCodex,
      engine: "claude" as const,
      name: "Claude Code",
      command: "/bin/claude",
      enabled: false,
    };
    await mockAcpWorkspace(page, [installedAcpCodex, claude]);
    const changes: { method: string; body: unknown }[] = [];
    await page.route("**/v1/acp/registry/configuration", (route) => {
      changes.push({
        method: route.request().method(),
        body: route.request().postDataJSON() as unknown,
      });
      return changes.length === 1
        ? route.fulfill({
            status: 502,
            json: { code: "PROVIDER_ERROR", message: "offline", retryable: false },
          })
        : route.fulfill({ json: { agents: [installedAcpCodex, { ...claude, enabled: true }] } });
    });
    await page.route("**/v1/acp/agents/codex/settings-snapshot", (route) =>
      route.fulfill({
        json: { profile: { engine: "codex", protocolVersion: 2, authMethods: [] } },
      }),
    );
    let inspections = 0;
    await page.route("**/v1/acp/agents/claude/settings-snapshot", (route) => {
      if (route.request().method() === "POST") inspections += 1;
      return route.fulfill({
        json: {
          profile: {
            engine: "claude",
            protocolVersion: 2,
            authStatus: { kind: "account", label: "Claude" },
            authMethods: [{ id: "native-login", name: "原生登录", description: null }],
          },
        },
      });
    });
    await page.route("**/v1/acp/agents/claude/defaults", (route) =>
      route.fulfill({
        json: { configOptions: [], defaults: {}, unmappedLegacy: [], invalidDefaults: [] },
      }),
    );
    const legacy: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (/^\/v1\/(?:engines\/claude|claude\/settings)(?:\/|$)/u.test(path)) legacy.push(path);
    });
    await page.goto("/p/codexly");
    if (width < 600) await page.getByRole("button", { name: "展开项目侧栏", exact: true }).click();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("region", { name: "全局设置" });
    await settings.getByRole("button", { name: "ACP", exact: true }).click();
    await settings.getByRole("button", { name: "Claude Code", exact: true }).click();
    const enable = settings.getByRole("switch", { name: "启用 Claude Code", exact: true });
    await expect(enable).not.toBeChecked();
    await expect(enable).toBeEnabled();
    await expect.poll(() => inspections).toBe(1);

    // 只有已连接的 Agent 可以启用，目录更新失败时保持关闭。
    await enable.click();
    await expect(page.getByRole("heading", { name: "更新失败", exact: true })).toBeVisible();
    await expect(enable).not.toBeChecked();
    expect(inspections).toBe(1);
    await enable.click();
    await expect(enable).toBeChecked();
    await expect(settings.getByRole("heading", { name: "连接配置", exact: true })).toBeVisible();
    expect(inspections).toBe(1);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toEqual({
      method: "PUT",
      body: {
        engine: "claude",
        name: "Claude Code",
        command: "/bin/claude",
        args: [],
        enabled: true,
      },
    });
    expect(changes[1]).toEqual(changes[0]);
    expect(await page.evaluate(() => localStorage.getItem("codeagent:engine-setup:v1"))).toBe(
      marker,
    );
    expect(legacy).toEqual([]);
  });
}
