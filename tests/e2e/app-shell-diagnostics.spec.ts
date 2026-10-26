import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures/app-shell.js";

// ZIP 生成及下载走真实测试服务，覆盖浏览器原生下载与服务端临时文件链路。
test.beforeEach(async ({ page }) => {
  await page.route("**/v1/diagnostics/codex", (route) => route.continue());
  await page.route("**/v1/diagnostics/downloads/*", (route) => route.continue());
});

const snapshot = {
  version: 1,
  exportedAt: "2026-10-23T00:00:00.000Z",
  runtime: {
    nodeVersion: "v24.0.0",
    platform: "linux",
    arch: "x64",
    uptimeSeconds: 5,
    memoryBytes: 100,
  },
  logs: [JSON.stringify({ level: 50, errorCode: "TEST_FAILURE" })],
  droppedEntries: 0,
};

for (const mobile of [false, true]) {
  test(`downloads diagnostics with failed version checks ${mobile ? "on narrow screens" : "on desktop"} @cross-browser`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/v1/app-info*", (route) =>
      route.fulfill({
        status: 503,
        json: { code: "INTERNAL_ERROR", message: "offline", retryable: true },
      }),
    );
    await page.route("**/v1/diagnostics", (route) => route.fulfill({ json: snapshot }));
    await page.goto("/p/codexly");
    if (mobile) await page.getByRole("button", { name: "展开项目侧栏" }).click();
    // 通过固定关于入口进入，覆盖真实懒加载设置链路。
    const trigger = page.locator("#global-settings-about-trigger");
    if (await trigger.isVisible()) await trigger.click();
    else {
      await page.getByRole("button", { exact: true, name: "设置" }).click();
      await page.getByRole("button", { exact: true, name: "关于" }).click();
    }
    const button = page.getByRole("button", { name: "导出诊断日志", exact: true });
    await expect(button).toBeVisible();
    await page.evaluate(() =>
      window.dispatchEvent(new ErrorEvent("error", { error: new Error("diagnostic-test-error") })),
    );
    const waiting = page.waitForEvent("download");
    const saving = page.waitForRequest((request) =>
      request.url().endsWith("/v1/diagnostics/codex"),
    );
    await button.click();
    const download = await waiting;
    expect(download.suggestedFilename()).toMatch(/^codexly-diagnostics-web-.*\.zip$/u);
    const file = await download.path();
    const zip = await readFile(file);
    expect(zip.subarray(0, 4).toString("hex")).toBe("504b0304");
    const requestBody = (await saving).postDataJSON() as { application: string };
    expect(zip.includes(Buffer.from(requestBody.application))).toBe(true);
    expect(zip.toString()).toContain('"codexDiagnostics":{"status":"unavailable"}');
    const archive: unknown = JSON.parse(requestBody.application);
    expect(archive).toMatchObject({
      server: { logs: snapshot.logs },
      browser: {
        logs: expect.arrayContaining([
          expect.objectContaining({ event: "window_error", errorMessage: "diagnostic-test-error" }),
        ]),
      },
    });
    await expect(button).toBeEnabled();
  });
}

test("prevents concurrent exports and retries after failure", async ({ page }) => {
  const { promise: pending, resolve: release } = Promise.withResolvers<undefined>();
  let calls = 0;
  await page.route("**/v1/diagnostics", async (route) => {
    calls++;
    if (calls === 1) {
      await pending;
      await route.fulfill({
        status: 503,
        json: { code: "INTERNAL_ERROR", message: "offline", retryable: true },
      });
    } else await route.fulfill({ json: snapshot });
  });
  await page.goto("/p/codexly");
  await page.locator("#global-settings-about-trigger").click();
  await page.getByRole("button", { name: "导出诊断日志", exact: true }).click();
  await expect(page.getByRole("button", { name: "正在导出", exact: true })).toBeDisabled();
  release(undefined);
  await expect(
    page.getByText("诊断日志导出失败，请检查服务连接后重试。", { exact: true }),
  ).toBeVisible();
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出诊断日志", exact: true }).click();
  await waiting;
  expect(calls).toBe(2);
});
