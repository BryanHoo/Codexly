import { expect, test } from "./fixtures/app-shell.js";

for (const mobile of [false, true]) {
  test(`submits history compression on ${mobile ? "mobile @cross-browser" : "desktop"}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    let calls = 0;
    await page.route("**/v1/history/compress", async (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().headers()["idempotency-key"]).toBeTruthy();
      calls += 1;
      await route.fulfill({ json: { status: "scheduled" } });
    });
    await page.goto("/p/codexly/t/task-1");
    if (mobile) await page.getByRole("button", { name: "展开项目侧栏" }).click();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settings = page.getByRole("region", { name: "全局设置" });
    await settings.getByRole("button", { name: "智能体配置", exact: true }).click();
    const action = settings.getByRole("button", { name: "压缩历史文件" });
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeVisible();
    expect(calls).toBe(0);
    await expect(settings.getByText(/释放服务端磁盘空间/u)).toBeVisible();
    await action.click();
    await expect(settings.getByRole("status")).toContainText("已提交后台压缩请求");
    expect(calls).toBe(1);
    await expect(settings.getByRole("status")).toContainText("不表示压缩已完成");
  });
}
