import { expect, test } from "./fixtures/app-shell.js";

for (const width of [390, 1280]) {
  test(`ACP 设置从工作台能力进入认证与供应商编辑 ${String(width)}px @cross-browser`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem(
        "codeagent:engine-setup:v1",
        JSON.stringify({ engines: ["codex"], complete: true }),
      );
    });
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
    let reads = 0;
    await page.route("**/v1/acp/agents/codex", (route) => {
      reads += 1;
      return route.fulfill({
        json: {
          engine: "codex",
          protocolVersion: 1,
          providerConfiguration: true,
          authMethods: [{ id: "native-login", name: "智能体登录" }],
        },
      });
    });
    const calls: unknown[] = [];
    await page.route("**/v1/acp/agents/codex/authenticate", (route) => {
      calls.push(route.request().postDataJSON() as unknown);
      return route.fulfill({ json: {} });
    });
    const writes: unknown[] = [];
    const slot = { providerId: "gateway", supported: ["native-protocol"], required: false };
    let current = { apiType: "native-protocol", baseUrl: "https://old.example" };
    await page.route("**/v1/acp/agents/codex/providers", (route) => {
      if (route.request().method() === "PUT") {
        writes.push(route.request().postDataJSON() as unknown);
        current = { ...current, baseUrl: "https://new.example" };
      }
      return route.fulfill({
        json: { providers: [{ ...slot, current }], restartRequired: writes.length > 0 },
      });
    });
    await page.goto("/p/codexly");
    if (width < 600) await page.getByRole("button", { name: "展开项目侧栏", exact: true }).click();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("region", { name: "全局设置" });
    await expect(settings.getByRole("searchbox")).toBeVisible();
    expect(reads).toBe(0);
    await settings
      .getByRole("group", { name: "Codex", exact: true })
      .getByRole("button", { name: "模型服务", exact: true })
      .click();
    const login = settings.getByRole("button", { name: "智能体登录", exact: true });
    await expect(login).toBeEnabled();
    expect(calls).toEqual([]);
    await login.click();
    await expect(settings.getByText("认证请求已完成。", { exact: true })).toBeVisible();
    expect(calls).toEqual([{ methodId: "native-login" }]);
    await expect(settings.getByRole("textbox", { name: "API 地址" })).toHaveCount(0);
    const provider = settings.getByRole("group", { name: "gateway", exact: true });
    await provider.getByRole("button", { name: "编辑", exact: true }).click();
    await provider
      .getByRole("textbox", { name: "服务地址", exact: true })
      .fill("https://new.example");
    const save = provider.getByRole("button", { name: "保存", exact: true });
    await expect(save).toBeDisabled();
    await provider.getByRole("checkbox", { name: "替换现有配置和请求头" }).check();
    await save.click();
    await expect(provider.getByText("https://new.example", { exact: true })).toBeVisible();
    expect(writes).toEqual([
      {
        providerId: "gateway",
        apiType: "native-protocol",
        baseUrl: "https://new.example",
        headers: {},
      },
    ]);
  });
}
