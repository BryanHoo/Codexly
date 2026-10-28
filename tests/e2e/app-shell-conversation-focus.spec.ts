import { expect, taskSnapshot, taskSnapshotRoute, test } from "./fixtures/app-shell.js";

for (const width of [1280, 390]) {
  test(`聊天阅读留白与问题吸顶 ${String(width)}px @cross-browser`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await page.addInitScript(
      (theme) => {
        localStorage.setItem("codexly.theme-preference", JSON.stringify({ theme, version: 1 }));
      },
      width === 390 ? "dark" : "light",
    );
    const prompts = [
      "先检查项目结构",
      "继续分析：" + "请保留详细的背景与约束。".repeat(40),
      "最后总结验证结果",
    ];
    await page.route(taskSnapshotRoute("task-1"), (route) =>
      route.fulfill({
        json: {
          checkpoint: { sequence: 0, sessionId: "e2e-session" },
          snapshot: {
            ...taskSnapshot,
            turns: prompts.map((text, index) => ({
              id: `focus-turn-${String(index)}`,
              status: "completed",
              error: null,
              startedAt: "2026-10-28T07:00:00.000Z",
              completedAt: "2026-10-28T07:01:00.000Z",
              items: [
                { id: `focus-user-${String(index)}`, type: "message", role: "user", text },
                {
                  id: `focus-answer-${String(index)}`,
                  type: "message",
                  role: "assistant",
                  text: Array.from(
                    { length: 24 },
                    (_, line) =>
                      `第 ${String(line + 1)} 项：检查共享组件和当前工作区，记录结果并保留用户的阅读位置。`,
                  ).join("\n\n"),
                },
              ],
            })),
          },
        },
      }),
    );
    await page.goto("/p/codexly/t/task-1");
    const viewport = page.locator('[data-slot="message-scroller-viewport"]');
    await expect(viewport).toBeVisible();
    const sticky = viewport.locator("[data-conversation-sticky-prompt]");
    const gapError = () =>
      viewport.evaluate((node) => {
        const rows = node.querySelectorAll("[data-conversation-row]");
        const last = rows[rows.length - 1];
        if (!last) return Infinity;
        return Math.abs(
          node.getBoundingClientRect().bottom -
            last.getBoundingClientRect().bottom -
            node.clientHeight / 4,
        );
      });
    await expect.poll(gapError).toBeLessThan(1);
    await expect(sticky).toContainText("最后总结验证结果");
    // 模拟窄屏软键盘改变可视高度；输入框折叠入口只存在于桌面分屏，另在下方验证。
    await page.setViewportSize({ width, height: 600 });
    await expect.poll(gapError).toBeLessThan(1);
    await page.setViewportSize({ width, height: 800 });
    await expect.poll(gapError).toBeLessThan(1);
    await page.screenshot({ path: testInfo.outputPath("conversation-reading-focus.png") });
    const questions = viewport.locator('[data-role="user"]');
    await questions.nth(1).evaluate((node) => {
      const region = node.closest('[data-slot="message-scroller-viewport"]');
      if (!region) throw new Error("聊天滚动区不存在");
      region.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -100 }));
      region.scrollTop += node.getBoundingClientRect().top - region.getBoundingClientRect().top + 1;
    });
    // 长问题只裁切顶部 1px 就应出现摘要，不等待气泡与元数据整体离屏。
    await expect(sticky).toContainText("继续分析");
    await questions.nth(1).evaluate((node) => {
      const region = node.closest('[data-slot="message-scroller-viewport"]');
      if (!region) throw new Error("聊天滚动区不存在");
      region.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -100 }));
      region.scrollTop +=
        node.getBoundingClientRect().bottom - region.getBoundingClientRect().top + 100;
    });
    await expect(sticky).toContainText("继续分析");
    await expect(sticky).toHaveCount(1);
    const summary = sticky.locator("[data-conversation-sticky-text]");
    expect(await summary.evaluate((node) => node.clientHeight)).toBeLessThanOrEqual(40);
    await page.screenshot({ path: testInfo.outputPath("conversation-long-question.png") });
    // 鼠标在浮层上滚动仍使用原生 viewport，避免摘要挡住滚动和触控。
    const stickyButton = sticky.getByRole("button");
    const restingBackground = await stickyButton.evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    );
    await sticky.hover();
    await stickyButton.evaluate(async (node) => {
      await Promise.all(
        node.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
      );
    });
    // 明暗主题下悬停仍应遮住下方正文，不能被透明的通用按钮悬停色覆盖。
    await expect(stickyButton).toHaveCSS("background-color", restingBackground);
    await page.screenshot({ path: testInfo.outputPath("conversation-question-hover.png") });
    const beforeWheel = await viewport.evaluate((node) => node.scrollTop);
    await page.mouse.wheel(0, 100);
    await expect
      .poll(() => viewport.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(beforeWheel + 20);
    await sticky.getByRole("button").click();
    await expect(sticky).toHaveCount(0);
    await expect(viewport).toBeFocused();
    expect(
      await viewport.evaluate((node) => node.scrollWidth - node.clientWidth),
    ).toBeLessThanOrEqual(1);
    if (width > 760) {
      await page.keyboard.press("Alt+Shift+ArrowRight");
      const pane = page.locator("[data-split-pane]").filter({ has: viewport });
      await expect(pane.getByRole("button", { name: "展开输入框", exact: true })).toBeVisible();
      await pane.getByRole("button", { name: "回到底部", exact: true }).click();
      await expect.poll(gapError).toBeLessThan(1);
      await pane.getByRole("button", { name: "展开输入框", exact: true }).click();
      await expect.poll(gapError).toBeLessThan(1);
      await pane.getByRole("button", { name: "收起输入框", exact: true }).click();
      await expect.poll(gapError).toBeLessThan(1);
      await pane.getByRole("button", { name: "展开输入框", exact: true }).click();
    }
    let releaseSubmission: () => void = () => undefined;
    const submissionGate = new Promise<void>((resolve) => {
      releaseSubmission = resolve;
    });
    await page.route("**/v1/projects/codexly/submissions", async (route) => {
      await submissionGate;
      await route.fulfill({
        status: 201,
        json: {
          checkpoint: { sequence: 0, sessionId: "e2e-session" },
          taskId: "task-1",
          turn: {
            id: "focus-next-turn",
            status: "running",
            startedAt: new Date().toISOString(),
            completedAt: null,
            error: null,
            items: [],
          },
        },
      });
    });
    const composerScope =
      width > 760 ? page.locator("[data-split-pane]").filter({ has: viewport }) : page;
    await composerScope.getByRole("textbox", { name: "任务输入" }).fill("从顶部开始新一轮");
    await composerScope.getByRole("button", { name: "提交", exact: true }).click();
    try {
      const nextQuestion = questions.filter({ hasText: "从顶部开始新一轮" });
      await expect(nextQuestion).toBeVisible();
      await expect
        .poll(() =>
          nextQuestion.evaluate((node) => {
            const region = node.closest('[data-slot="message-scroller-viewport"]');
            if (!region) throw new Error("聊天滚动区不存在");
            return node.getBoundingClientRect().top - region.getBoundingClientRect().top;
          }),
        )
        .toBeCloseTo(12, 0);
      await expect(sticky).toHaveCount(0);
      expect(
        await viewport
          .locator('[data-conversation-row="turn"]')
          .last()
          .evaluate((node) => {
            const region = node.closest('[data-slot="message-scroller-viewport"]');
            if (!region) throw new Error("聊天滚动区不存在");
            return node.getBoundingClientRect().bottom - region.getBoundingClientRect().top;
          }),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath("conversation-new-turn.png") });
    } finally {
      releaseSubmission();
    }
  });
}
