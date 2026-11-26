import { expect, test } from "./fixtures/app-shell.js";
import { installedAcpCodex, mockAcpWorkspace } from "./fixtures/acp-defaults.js";

for (const width of [390, 1280]) {
  test(`ACP 后台检测失败后重试并隔离旧完成标记 ${String(width)}px @cross-browser`, async ({
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
          turns: { compact: false, interrupt: false, review: false, start: true, steer: false },
        },
      }),
    );
    let inspections = 0;
    page.on("request", (request) => {
      if (/\/v1\/acp\/agents\/codex(?:\/defaults)?$/u.test(new URL(request.url()).pathname))
        inspections += 1;
    });
    await mockAcpWorkspace(page);
    const refreshes: (string | null)[] = [];
    await page.route(/\/v1\/acp\/registry(?:\?.*)?$/u, (route) => {
      refreshes.push(new URL(route.request().url()).searchParams.get("refresh"));
      return refreshes.length === 1
        ? route.fulfill({
            status: 502,
            json: { code: "PROVIDER_ERROR", message: "offline", retryable: false },
          })
        : route.fulfill({ json: { agents: [installedAcpCodex] } });
    });

    await page.goto("/p/codexly");
    const editor = page.getByRole("textbox", { name: "任务输入", exact: true });
    await expect(editor).toBeVisible();
    await expect(page.getByRole("heading", { name: "Agent 后台检测失败" })).toBeVisible();
    expect(refreshes).toEqual([null]);
    expect(
      await page.evaluate(() => localStorage.getItem("codexly:acp-engine-setup:v1")),
    ).toBeNull();
    // 重试只刷新目录。工作区已可用，探测过程无需预读认证或会话默认值。
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Agent 已就绪" })).toBeVisible();
    expect(refreshes).toEqual([null, "true"]);
    expect(await page.evaluate(() => localStorage.getItem("codeagent:engine-setup:v1"))).toBe(old);
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("codexly:acp-engine-setup:v1") ?? "null") as unknown,
      ),
    ).toEqual({ engines: ["codex"], complete: true });

    await page.reload();
    await expect(editor).toBeVisible();
    await expect.poll(() => refreshes).toEqual([null, "true", null]);
    await expect(page.getByRole("heading", { name: "Agent 已就绪" })).toHaveCount(0);
    expect(inspections).toBe(0);
  });
}
