import {
  taskSnapshotRoute,
  expect,
  taskSnapshot,
  taskSnapshotResponse,
  test,
} from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("submits a prompt and streams the completed reply @cross-browser", async ({ page }) => {
  await page.unroute("**/v1/**");
  await page.goto("/p/codexly");

  await page.getByRole("textbox", { name: "任务输入" }).fill("完成流式回复");
  // 首次提交接收后还要读取新任务快照，等应用完成交接所需的两个请求。
  const [submission, snapshot] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/v1/projects/codexly/submissions",
    ),
    page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        /^\/v1\/projects\/codexly\/tasks\/[\da-f-]{36}$/u.test(new URL(response.url()).pathname),
    ),
    page.getByRole("button", { exact: true, name: "提交" }).click(),
  ]);
  expect(submission.status()).toBe(201);
  expect(snapshot.ok()).toBe(true);

  await expect(page).toHaveURL(/\/p\/codexly\/t\/[\da-f-]{36}$/);
  const turn = page.getByLabel("Turn 1");
  await expect(turn.getByText("完成流式回复", { exact: true })).toHaveCount(1);
  await expect(turn.getByText("流式回复完成", { exact: true })).toHaveCount(1);
  await expect(page.getByLabel("Turn 1")).toHaveAttribute("data-status", "completed", {
    timeout: 10_000,
  });
  await expect(page.getByRole("button", { exact: true, name: "提交" })).toBeVisible();
});

test("does not show a tooltip for a truncated command title", async ({ page }) => {
  const command =
    "pnpm exec vitest run apps/web/src/features/workbench/components/task-timeline.test.tsx --testNamePattern tool-command-title-tooltip";
  await page.route(taskSnapshotRoute("task-1"), async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshot,
          turns: taskSnapshot.turns.map((turn) => ({
            ...turn,
            items: [
              ...turn.items,
              {
                command,
                cwd: "/workspace/Codexly",
                id: "command-with-truncated-title",
                outputOmitted: { bytes: 0, lines: 0 },
                status: "completed",
                type: "command",
              },
            ],
          })),
        },
      },
    });
  });
  await page.setViewportSize({ height: 720, width: 640 });
  await page.goto("/p/codexly/t/task-1");

  // 等待异步 Markdown 升级完成，确保 hover 与 focus 检查发生在稳定布局中。
  await expect(page.getByRole("button", { name: "OpenAI", exact: true })).toBeVisible();
  const commandTitle = page.getByText(command, { exact: true });
  await expect(commandTitle).toBeVisible();
  expect(await commandTitle.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
    true,
  );

  await commandTitle.hover();
  await expect(page.getByRole("tooltip")).toHaveCount(0);

  await commandTitle.locator("..").focus();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("keeps long runtime activity details within the conversation", async ({ page }) => {
  const historicalTurn = taskSnapshot.turns[0];
  if (historicalTurn === undefined) {
    throw new Error("Expected the task fixture to contain a turn");
  }
  const longDetail = encodeURIComponent(
    JSON.stringify({
      "effort-estimate.md": "有效输出路径与需求分析".repeat(300),
    }),
  );
  await page.route(taskSnapshotRoute("task-1"), async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshot,
          status: "running",
          turns: [
            {
              ...historicalTurn,
              completedAt: null,
              items: [
                {
                  detail: longDetail,
                  id: "activity-long-detail",
                  label: "长执行详情",
                  status: "running",
                  type: "activity",
                },
              ],
              status: "running",
            },
          ],
        },
      },
    });
  });
  await page.setViewportSize({ height: 720, width: 1_280 });
  await page.goto("/p/codexly/t/task-1");

  await page.getByText("长执行详情", { exact: true }).click();
  const conversation = page.getByRole("region", { name: "会话内容" });
  await expect(page.getByText(longDetail, { exact: true })).toBeVisible();
  expect(await conversation.evaluate((element) => element.scrollWidth)).toBe(
    await conversation.evaluate((element) => element.clientWidth),
  );
});
