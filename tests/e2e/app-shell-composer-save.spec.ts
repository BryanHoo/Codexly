import { expect, projects, test } from "./fixtures/app-shell.js";

for (const scope of ["project", "chat"] as const) {
  for (const entry of scope === "project" ? ["new", "existing"] : ["new"]) {
    for (const width of [1280, 390]) {
      test(`发送下拉保存提示词并保留当前正文（${scope} ${entry} ${String(width)}） @cross-browser`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        // 显示名称与存储 ID 刻意不同，防止 ID 回退混过名称断言。
        await page.route("**/v1/projects", async (route) => {
          await route.fulfill({
            json: {
              data: projects.map((project) =>
                project.id === "codexly" ? { ...project, name: "示例工作项目" } : project,
              ),
              nextCursor: null,
            },
          });
        });
        const shared: unknown[] = [];
        await page.route("**/v1/saved-prompts", async (route) => {
          const input = route.request().postDataJSON() as { action: string; prompt?: unknown };
          if (input.action === "save") shared.push(input.prompt);
          await route.fulfill({ json: shared });
        });
        let submissions = 0;
        page.on("request", (request) => {
          if (request.method() === "POST" && request.url().endsWith("/submissions")) submissions++;
        });
        await page.goto(
          scope === "project"
            ? entry === "existing"
              ? "/p/codexly/t/task-1"
              : "/p/codexly"
            : "/temporary",
        );
        const prompt = page.getByRole("textbox", { name: "任务输入" });
        const content = "  检查当前实现。\n保留现有行为。  ";
        await prompt.fill(content);
        await expect(page.getByRole("button", { name: "提交", exact: true })).toHaveText("发送");
        await expect(page.getByRole("button", { name: "保存为待办", exact: true })).toHaveCount(0);
        await page.getByRole("button", { name: "更多发送操作" }).click();
        if (scope === "project")
          await expect(
            page.getByRole("menuitem", { name: "保存为待办", exact: true }),
          ).toBeVisible();
        await page.getByRole("menuitem", { name: "保存为常用提示词" }).click();
        await expect(page.getByRole("textbox", { name: "提示词内容", exact: true })).toHaveValue(
          content,
        );
        await expect(page.getByRole("combobox", { name: "可用范围" })).toHaveText(
          scope === "project" ? "示例工作项目" : "全局",
        );
        if (width === 390) {
          await page.getByRole("combobox", { name: "可用范围" }).click();
          await expect(page.getByRole("option", { name: "全局", exact: true })).toBeVisible();
          await expect(
            page.getByRole("option", { name: "示例工作项目", exact: true }),
          ).toBeVisible();
          await page.getByRole("option", { name: "superwork", exact: true }).click();
          await expect(page.getByRole("textbox", { name: "提示词内容", exact: true })).toHaveValue(
            content,
          );
        }
        const savedProjectId =
          width === 390 ? "superwork" : scope === "project" ? "codexly" : undefined;
        await page.getByRole("textbox", { name: "标题", exact: true }).fill("检查实现");
        await page.getByRole("button", { name: "保存", exact: true }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        expect(shared).toEqual([
          expect.objectContaining({
            name: "检查实现",
            content,
            ...(savedProjectId ? { projectId: savedProjectId } : {}),
          }),
        ]);
        if (!savedProjectId) expect(shared[0]).not.toHaveProperty("projectId");
        await expect(prompt).toHaveAttribute("data-serialized-value", content);
        expect(submissions).toBe(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
      });
    }
  }
}

for (const width of [1280, 390]) {
  test(`发送下拉保存待办且左侧直接发送（${String(width)}） @cross-browser`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/v1/projects/codexly/todos", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      // 请求 JSON 先收窄为 unknown，避免 any 泄漏到待办模拟响应。
      const draft: unknown = route.request().postDataJSON();
      const todo = {
        id: "saved-todo",
        projectId: "codexly",
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        draft,
      };
      await route.fulfill({ json: { todo, todos: { data: [todo] } } });
    });
    await page.goto("/p/codexly/t/task-1");
    const prompt = page.getByRole("textbox", { name: "任务输入" });
    await prompt.fill("稍后处理这个任务");
    await page.getByRole("button", { name: "更多发送操作" }).click();
    await page.getByRole("menuitem", { name: "保存为待办", exact: true }).click();
    await expect(prompt).toHaveAttribute("data-serialized-value", "");
    await prompt.fill("现在发送这个任务");
    const submission = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith("/submissions"),
    );
    await page.getByRole("button", { name: "提交", exact: true }).click();
    expect((await submission).postData()).toContain("现在发送这个任务");
  });
}
