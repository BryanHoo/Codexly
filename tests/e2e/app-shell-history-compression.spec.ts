import { createAcpCapabilities } from "../../packages/protocol/src/acp-capabilities.js";
import { expect, test } from "./fixtures/app-shell.js";

for (const mobile of [false, true]) {
  test(`ACP 配置不暴露旧历史压缩入口 ${mobile ? "mobile @cross-browser" : "desktop"}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem(
        "codeagent:engine-setup:v1",
        JSON.stringify({ engines: ["codex"], complete: true }),
      );
    });
    let calls = 0;
    await page.route("**/v1/capabilities", (route) =>
      route.fulfill({ json: createAcpCapabilities("codex") }),
    );
    await page.route("**/v1/acp/agents/codex", (route) =>
      route.fulfill({ json: { engine: "codex", protocolVersion: 1, authMethods: [] } }),
    );
    await page.route("**/v1/acp/agents/codex/defaults", (route) =>
      route.fulfill({
        json: { configOptions: [], defaults: {}, unmappedLegacy: [], invalidDefaults: [] },
      }),
    );
    await page.route("**/v1/history/compress", (route) => {
      calls++;
      return route.fulfill({ status: 409, json: { error: "unsupported" } });
    });
    await page.goto("/p/codexly/t/task-1");
    if (mobile) await page.getByRole("button", { name: "展开项目侧栏" }).click();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("region", { name: "全局设置" });
    await settings
      .getByRole("group", { name: "Codex", exact: true })
      .getByRole("button", { name: "智能体配置", exact: true })
      .click();
    await expect(settings.getByRole("heading", { name: "智能体配置", exact: true })).toBeVisible();
    await expect(settings.getByText("智能体未提供可配置选项")).toBeVisible();
    await expect(settings.getByRole("button", { name: "压缩历史文件" })).toHaveCount(0);
    expect(calls).toBe(0);
  });
}
