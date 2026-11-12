import { expect, test } from "./fixtures/app-shell.js";

for (const width of [390, 1280]) {
  test(`编辑草稿取消输入优化请求并保留新正文 ${String(width)}px @cross-browser`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    const id = crypto.randomUUID();
    let stateUrl = "";
    await page.route("**/v1/projects/codexly/prompt-optimization", async (route) => {
      expect(route.request().postDataJSON()).toEqual({ text: "修复登录" });
      stateUrl = `${new URL(route.request().url()).origin}/__test__/prompt-optimization/${id}`;
      // 使用同源真实 HTTP，取消必须关闭响应连接；不暂停浏览器的网络拦截。
      await route.continue({ url: stateUrl });
    });
    try {
      await page.goto("/p/codexly/t/task-1");
      const prompt = page.getByRole("textbox", { name: "任务输入" });
      await prompt.fill("修复登录");
      await page.getByRole("button", { name: "AI 优化提示词" }).click();
      await expect.poll(() => stateUrl).not.toBe("");
      const read = async () => (await page.request.get(stateUrl)).json() as Promise<unknown>;
      await expect.poll(read).toMatchObject({ entered: true, disconnected: false });
      await expect(page.getByRole("button", { name: "正在优化提示词…" })).toBeDisabled();
      await prompt.fill("新的草稿");
      await expect(prompt).toHaveAttribute("data-serialized-value", "新的草稿");
      await expect(page.getByRole("button", { name: "AI 优化提示词" })).toBeEnabled();
      await expect.poll(read).toMatchObject({ disconnected: true });
      await expect(prompt).toHaveAttribute("data-serialized-value", "新的草稿");
      await expect(page.getByText("提示词优化失败，请重试", { exact: true })).toHaveCount(0);
    } finally {
      if (stateUrl) await page.request.delete(stateUrl);
      await page.unrouteAll({ behavior: "wait" });
    }
  });
}
