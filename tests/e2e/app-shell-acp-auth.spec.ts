import { expect, test } from "./fixtures/app-shell.js";

for (const width of [390, 1280]) {
  test(`ACP 连接表单显式保存与原生凭据 ${String(width)}px @cross-browser`, async ({ page }) => {
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
    let source = "native",
      baseUrl = "https://global-custom.example/v1",
      apiType = "openai",
      signedIn = false;
    const auth: unknown[] = [],
      writes: unknown[] = [];
    await page.route("**/v1/acp/agents/codex", (route) =>
      route.fulfill({
        json: {
          engine: "codex",
          protocolVersion: 1,
          providerConfiguration: true,
          ...(baseUrl
            ? {
                connection: {
                  source,
                  baseUrl,
                  apiType,
                  hasCredentials: true,
                  providerId: "openai",
                },
              }
            : {}),
          authStatus: signedIn
            ? { kind: "account", label: "ChatGPT Pro", account: { email: "user@example.com" } }
            : { kind: "gateway", label: "Custom model gateway" },
          authMethods: [
            { id: "api-key", name: "API Key" },
            { id: "chat-gpt", name: "ChatGPT" },
          ],
        },
      }),
    );
    await page.route("**/v1/acp/agents/codex/authenticate", (route) => {
      auth.push(route.request().postDataJSON());
      signedIn = true;
      baseUrl = "";
      return route.fulfill({ json: {} });
    });
    await page.route("**/v1/acp/agents/codex/providers", (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as { baseUrl: string; apiType: string };
        writes.push(body);
        baseUrl = body.baseUrl;
        apiType = body.apiType;
        source = "application";
      }
      return route.fulfill({
        json: {
          providers: [
            {
              providerId: "openai",
              supported: ["openai", "openai-chat-completions"],
              required: false,
              current: { apiType, baseUrl },
            },
          ],
          restartRequired: false,
        },
      });
    });
    await page.goto("/p/codexly");
    if (width < 600) await page.getByRole("button", { name: "展开项目侧栏", exact: true }).click();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("region", { name: "全局设置" });
    await settings.getByRole("button", { name: "ACP", exact: true }).click();
    const url = settings.getByRole("textbox", { name: "API 地址", exact: true });
    await expect(url).toHaveValue(baseUrl);
    await expect(settings.getByRole("heading", { name: "ACP", exact: true })).toHaveCount(0);
    await expect(settings.getByText("Custom model gateway", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "全局设置", exact: true })).toBeVisible();
    await expect(settings.getByRole("button", { name: "取消修改", exact: true })).toHaveCount(0);
    await expect(settings.getByRole("searchbox", { name: "搜索 Agent", exact: true })).toHaveCount(
      0,
    );
    // 切换连接方式只编辑草稿，密钥必须填写并明确提交。
    await settings.getByRole("combobox", { name: "连接方式", exact: true }).click();
    await page.getByRole("option", { name: "账号登录", exact: true }).click();
    await settings.getByRole("combobox", { name: "登录方式", exact: true }).click();
    await page.getByRole("option", { name: "API Key", exact: true }).click();
    expect(auth).toEqual([]);
    await settings.getByRole("button", { name: "保存 API Key", exact: true }).click();
    expect(auth).toEqual([]);
    await settings.getByLabel("API Key", { exact: true }).fill("e2e-private-key");
    await settings.getByRole("button", { name: "保存 API Key", exact: true }).click();
    await expect
      .poll(() => auth)
      .toEqual([{ methodId: "api-key", credentials: { apiKey: "e2e-private-key" } }]);
    await expect(
      settings.getByText("ChatGPT Pro · user@example.com", { exact: true }),
    ).toBeVisible();
    await settings.getByRole("combobox", { name: "连接方式", exact: true }).click();
    await page.getByRole("option", { name: "自定义 API", exact: true }).click();
    await settings.getByRole("combobox", { name: "API 协议", exact: true }).click();
    await page.getByRole("option", { name: "OpenAI Chat Completions", exact: true }).click();
    await url.fill("https://replacement.example/v1");
    await settings.getByLabel("API Key", { exact: true }).fill("e2e-provider-key");
    expect(writes).toEqual([]);
    await settings.getByRole("button", { name: "保存连接", exact: true }).click();
    await expect(settings.getByText("应用内配置", { exact: true })).toBeVisible();
    expect(writes).toEqual([
      {
        providerId: "openai",
        apiType: "openai-chat-completions",
        baseUrl: "https://replacement.example/v1",
        headers: { Authorization: "Bearer e2e-provider-key" },
      },
    ]);
    await expect(settings.getByLabel("API Key", { exact: true })).toHaveValue("");
    await url.fill("https://keep-key.example/v1");
    await settings.getByRole("button", { name: "保存连接", exact: true }).click();
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1]).not.toHaveProperty("headers");
    expect(
      await page
        .locator("#global-settings-trigger")
        .evaluate((element) => element.getBoundingClientRect().height),
    ).toBeGreaterThan(0);
    await page
      .getByRole("dialog", { name: "全局设置", exact: true })
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await expect(page.getByRole("dialog", { name: "全局设置", exact: true })).toHaveCount(0);
  });
}
