import { expect, test } from "./fixtures/app-shell.js";

for (const width of [1280, 390]) {
  test(`按标题通过双入口插入提示词并保留正文（宽度 ${String(width)}） @cross-browser`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    // 使用旧存储格式验证真实升级路径：快捷词不再参与匹配，已有正文仍能使用。
    await page.addInitScript(() => {
      localStorage.setItem(
        "codexly.saved-prompts.v1",
        JSON.stringify({
          version: 1,
          prompts: [
            {
              id: "review",
              name: "Code Review 检查",
              shortcut: "legacy-shortcut",
              content: "逐项检查代码。\n补充测试。",
            },
            { id: "other-project", name: "其他项目", content: "不可见", projectId: "other" },
          ],
        }),
      );
    });
    let submissions = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/submissions")) submissions++;
    });
    await page.goto("/p/codexly/t/task-1");
    const prompt = page.getByRole("textbox", { name: "任务输入" });
    for (const trigger of ["/", "#"]) {
      await prompt.fill(`前文 ${trigger}code review`);
      await expect(page.getByRole("option", { name: /Code Review 检查/u })).toBeVisible();
      await prompt.press("Enter");
      await expect(prompt).toHaveAttribute(
        "data-serialized-value",
        "前文 逐项检查代码。\n补充测试。",
      );
      await expect(prompt).toBeFocused();
    }
    await prompt.fill("#");
    await expect(page.getByRole("option")).toHaveCount(1);
    await prompt.fill("#legacy-shortcut");
    await expect(page.getByRole("option")).toHaveCount(0);
    await expect(prompt).toHaveAttribute("data-serialized-value", "#legacy-shortcut");
    expect(submissions).toBe(0);
  });
}
