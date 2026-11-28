import { expect, test } from "./fixtures/app-shell.js";
import { installedAcpCodex, mockAcpWorkspace } from "./fixtures/acp-defaults.js";

for (const width of [390, 1280]) {
  test(`新建 ACP 草稿跳过旧模型查询，刷新后保留配置与首发身份 ${String(width)}px @cross-browser`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockAcpWorkspace(page);
    await page.route(/\/v1\/acp\/registry(?:\?.*)?$/u, async (route) => {
      // 完整目录扫描暂不返回，持久目录和配置缓存仍然可以开放首发。
      if (new URL(route.request().url()).searchParams.get("cached") === "true")
        await route.fulfill({ json: { agents: [installedAcpCodex] } });
    });
    await page.addInitScript(() => {
      localStorage.setItem(
        "codeagent:engine-setup:v1",
        JSON.stringify({ engines: ["codex"], complete: true }),
      );
    });
    const legacyModels: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/v1/models") legacyModels.push(request.url());
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
    const cacheRequests: string[] = [];
    const preview = {
      values: { raw: false },
      configOptions: [{ id: "raw", name: "ACP 原始开关", type: "boolean", currentValue: false }],
    };
    await page.route("**/v1/acp/agents/codex/config-cache", async (route) => {
      const method = route.request().method();
      cacheRequests.push(method);
      // 未完成的后台探测不能挡住磁盘缓存的控件或首发。
      if (method === "GET") await route.fulfill({ json: preview });
    });
    const submissions: { key: string | undefined; input: Record<string, unknown> }[] = [];
    await page.route("**/v1/projects/codexly/submissions", (route) => {
      submissions.push({
        key: route.request().headers()["idempotency-key"],
        input: route.request().postDataJSON() as Record<string, unknown>,
      });
      return route.fulfill({
        status: 502,
        json: { code: "PROVIDER_ERROR", message: "ACP 尚未发送", retryable: false },
      });
    });
    await page.goto("/p/codexly");
    const editor = page.getByRole("textbox", { name: "任务输入" });
    await editor.fill("保留首发草稿");
    // 从会话窗格的真实模型入口验证外层工作台打开 ACP 设置，并保留未发送草稿。
    await page.getByRole("button", { name: "Codex / 选择模型", exact: true }).click();
    await page.getByRole("button", { name: "配置 Agent", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "全局设置" });
    await expect(settings.getByRole("button", { name: "ACP", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await settings.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(editor).toHaveAttribute("data-serialized-value", "保留首发草稿");
    const rawOption = page.getByRole("button", { name: "ACP 原始开关", exact: true });
    const more = page.getByRole("button", { name: "更多配置", exact: true });
    // 窄屏会将原始配置收进溢出菜单，使用真实入口完成相同设置操作。
    await rawOption.or(more).first().waitFor({ state: "visible" });
    const collapsed = !(await rawOption.isVisible());
    if (collapsed) await more.click();
    await rawOption.click();
    await page.getByRole("menuitemradio", { name: "开启", exact: true }).click();
    await expect(rawOption).toHaveText(/开启/u);
    if (collapsed) await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "提交", exact: true }).click();
    await expect.poll(() => submissions.length).toBe(1);
    await expect(editor).toHaveAttribute("data-serialized-value", "保留首发草稿");
    await page.reload();
    await expect(editor).toHaveAttribute("data-serialized-value", "保留首发草稿");
    await page.getByRole("button", { name: "提交", exact: true }).click();
    await expect.poll(() => submissions.length).toBe(2);
    expect(submissions[1]).toEqual(submissions[0]);
    expect(submissions[0]?.input).toMatchObject({
      type: "acp-prompt",
      engine: "codex",
      initialConfig: null,
      configOverrides: { raw: true },
      workspacePath: "/workspace/Codexly",
    });
    expect(submissions[0]?.input).not.toHaveProperty("options");
    await expect.poll(() => cacheRequests.filter((method) => method === "GET")).toHaveLength(2);
    await expect.poll(() => cacheRequests.filter((method) => method === "POST")).toHaveLength(2);
    expect(legacyModels).toEqual([]);
  });
}
