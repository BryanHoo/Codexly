import { expect, taskSnapshot, taskSnapshotResponse, test } from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("queues follow-up messages and can steer or cancel them during an active turn", async ({
  page,
}) => {
  await page.unroute("**/v1/**");
  await page.route("**/v1/settings", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { settings: Record<string, unknown> };
    await route.fulfill({
      response,
      json: { settings: { ...body.settings, followUpBehavior: "queue" } },
    });
  });
  await page.goto("/p/codexly");
  const input = page.getByRole("textbox", { name: "任务输入" });
  await input.fill("等待中断");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect(page).toHaveURL(/\/p\/codexly\/t\/task-action-\d+$/u);
  await expect(page.getByRole("button", { name: "停止" })).toBeVisible();
  await expect(input).toHaveAttribute("data-placeholder", "输入后续要求");

  const taskId = page.url().split("/").at(-1) ?? "";
  const attachmentResponse = await page.request.post("/v1/projects/codexly/attachments/text", {
    headers: { "idempotency-key": "external-queue-attachment" },
    multipart: {
      attachment: {
        buffer: Buffer.from("队列附件内容", "utf8"),
        mimeType: "text/plain",
        name: "queue-note.txt",
      },
    },
  });
  expect(attachmentResponse.status()).toBe(201);
  const attachment = (await attachmentResponse.json()) as { attachment: { id: string } };
  const externalQueueResponse = await page.request.post(
    `/v1/projects/codexly/tasks/${taskId}/queue`,
    {
      data: {
        clientUserMessageId: "external-client-message",
        input: {
          attachments: [{ id: attachment.attachment.id }],
          skills: [],
          text: "来自其他客户端",
          type: "prompt",
        },
      },
      headers: { "idempotency-key": "external-queue-add" },
    },
  );
  expect(externalQueueResponse.status()).toBe(201);
  const externalQueue = (await externalQueueResponse.json()) as {
    queuedSubmission: { id: string };
  };
  await expect(page.getByText("来自其他客户端", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("来自其他客户端", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "编辑排队消息：来自其他客户端" }).click();
  await expect(page.getByText("queue-note.txt", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("list", { name: "已排队消息" }).getByText("来自其他客户端", { exact: true }),
  ).toHaveCount(0);
  const externalDeleteResponse = await page.request.delete(
    `/v1/projects/codexly/tasks/${taskId}/queue/${externalQueue.queuedSubmission.id}`,
    { headers: { "idempotency-key": "external-queue-delete" } },
  );
  expect(externalDeleteResponse.status()).toBe(200);
  await input.fill("外部删除后重新排队");
  await page.getByRole("button", { exact: true, name: "排队消息" }).click();
  await expect(page.getByText("外部删除后重新排队", { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "取消排队：外部删除后重新排队" }).click();

  let steerPayload: unknown;
  await page.route("**/v1/projects/codexly/tasks/*/turns/*/steer", async (route) => {
    const request = route.request();
    const payload = request.postDataJSON() as { taskId: string };
    steerPayload = payload;
    await route.fulfill({ response: await route.fetch() });
  });
  const queueMessage = page.getByRole("button", { exact: true, name: "排队消息" });
  await input.fill("先补充失败测试");
  await expect(queueMessage).toBeVisible();
  await queueMessage.click();

  await expect(page.getByText("先补充失败测试", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("先补充失败测试", { exact: true })).toBeVisible();
  const queuedList = page.getByRole("list", { name: "已排队消息" });
  expect(await queuedList.evaluate((element) => element.closest("form") === null)).toBe(true);
  await page.getByRole("button", { name: "编辑排队消息：先补充失败测试" }).click();
  await expect(input).toHaveAttribute("data-serialized-value", "先补充失败测试");
  await input.fill("先补充失败测试（已编辑）");
  await queueMessage.click();
  const steerQueued = page.getByRole("button", { name: "立即引导：先补充失败测试（已编辑）" });
  await expect(steerQueued).toBeEnabled();
  await steerQueued.hover();
  await expect(page.getByRole("tooltip")).toHaveText("立即作为引导发送");
  await steerQueued.click();
  await expect(page.getByRole("status", { name: "等待发送" })).toBeVisible();
  await expect
    .poll(() => steerPayload)
    .toEqual({
      input: { attachments: [], skills: [], text: "先补充失败测试（已编辑）", type: "prompt" },
      taskId: expect.stringMatching(/^task-action-\d+$/u),
    });
  await expect(
    page.getByRole("button", { name: "编辑排队消息：先补充失败测试（已编辑）" }),
  ).toHaveCount(0);
  await expect(page.getByRole("status", { name: "等待发送" })).toHaveCount(0);
  await expect(page.getByText("先补充失败测试（已编辑）", { exact: true })).toHaveCount(1);

  await input.fill("无需继续的消息");
  await queueMessage.click();
  const cancelQueued = page.getByRole("button", { name: "取消排队：无需继续的消息" });
  await cancelQueued.hover();
  await expect(page.getByRole("tooltip")).toHaveText("取消排队");
  await cancelQueued.click();
  await expect(page.getByText("无需继续的消息", { exact: true })).toHaveCount(0);

  await input.fill("顺序一");
  await queueMessage.click();
  await input.fill("顺序二");
  await queueMessage.click();
  await page.getByRole("button", { name: "上移排队消息：顺序二" }).click();
  await expect
    .poll(async () =>
      queuedList
        .getByRole("listitem")
        .allTextContents()
        .then((items) => items.map((item) => item.trim())),
    )
    .toEqual(["顺序二", "顺序一"]);
  await page.getByRole("button", { name: "取消排队：顺序二" }).click();
  await page.getByRole("button", { name: "取消排队：顺序一" }).click();

  await input.fill("自动续发消息");
  await queueMessage.click();
  await page.getByRole("button", { name: "停止" }).click();
  const nextTurn = page.getByLabel("Turn 2");
  await expect(nextTurn.getByText("自动续发消息", { exact: true })).toBeVisible();
  await expect(nextTurn).toHaveAttribute("data-status", "completed");
});

test("keeps a direct steer above the composer until its streamed message appears", async ({
  page,
}) => {
  await page.unroute("**/v1/**");
  await page.route("**/v1/settings", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { settings: Record<string, unknown> };
    await route.fulfill({
      response,
      json: { settings: { ...body.settings, followUpBehavior: "steer" } },
    });
  });
  await page.goto("/p/codexly");
  const input = page.getByRole("textbox", { name: "任务输入" });
  await input.fill("等待中断");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect(page).toHaveURL(/\/p\/codexly\/t\/task-action-\d+$/u);

  await input.fill("直接补充失败测试");
  await page.getByRole("button", { name: "发送引导" }).click();

  await expect(page.getByText("直接补充失败测试", { exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "等待发送" })).toBeVisible();
  await expect(page.getByRole("button", { name: "编辑排队消息：直接补充失败测试" })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "等待发送" })).toHaveCount(0);
  await expect(page.getByText("直接补充失败测试", { exact: true })).toHaveCount(1);
});

test("submits a prompt and streams the completed reply @cross-browser", async ({ page }) => {
  await page.unroute("**/v1/**");
  await page.goto("/p/codexly");

  await page.getByRole("textbox", { name: "任务输入" }).fill("完成流式回复");
  await page.getByRole("button", { exact: true, name: "提交" }).click();

  await expect(page).toHaveURL(/\/p\/codexly\/t\/task-action-\d+$/);
  await expect(page.getByText("完成流式回复", { exact: true })).toHaveCount(1);
  await expect(page.getByText("流式回复完成", { exact: true })).toHaveCount(1);
  await expect(page.getByLabel("Turn 1")).toHaveAttribute("data-status", "completed", {
    timeout: 10_000,
  });
  await expect(page.getByRole("button", { exact: true, name: "提交" })).toBeVisible();
});

test("shows the latest raw Codex operation throughout a running turn", async ({ page }) => {
  await page.unroute("**/v1/**");
  await page.goto("/p/codexly");

  await page.getByRole("textbox", { name: "任务输入" }).fill("检查运行状态");
  await page.getByRole("button", { exact: true, name: "提交" }).click();

  await expect(page.getByText("正在运行 rg --files", { exact: true })).toBeVisible();
  const runningShimmer = page.locator('[data-agent-shimmer][aria-label^="AI 回复正在运行"]');
  const initialShimmer = await runningShimmer.elementHandle();
  if (initialShimmer === null) {
    throw new Error("未找到运行态 Shimmer");
  }
  // 节点可见后 CSS 动画仍可能尚未启动，先等待时间轴完成初始化。
  await expect
    .poll(() =>
      runningShimmer.evaluate((node) => {
        const animation = node.getAnimations()[0];
        return animation?.playState === "running" && animation.startTime !== null;
      }),
    )
    .toBe(true);
  const initialAnimation = await runningShimmer.evaluate((node) => ({
    currentTime: Number(node.getAnimations()[0]?.currentTime ?? 0),
    spread: node.style.getPropertyValue("--ui-shimmer-spread"),
    startTime: Number(node.getAnimations()[0]?.startTime ?? 0),
  }));

  await expect(page.getByText("正在运行 context7/query-docs", { exact: true })).toBeVisible();
  const retainedShimmer = await runningShimmer.evaluate(
    (node, initialNode) => node === initialNode,
    initialShimmer,
  );
  const updatedAnimation = await runningShimmer.evaluate((node) => ({
    currentTime: Number(node.getAnimations()[0]?.currentTime ?? 0),
    spread: node.style.getPropertyValue("--ui-shimmer-spread"),
    startTime: Number(node.getAnimations()[0]?.startTime ?? 0),
  }));
  expect(retainedShimmer).toBe(true);
  expect(updatedAnimation.spread).toBe(initialAnimation.spread);
  expect(updatedAnimation.startTime).toBe(initialAnimation.startTime);
  expect(updatedAnimation.currentTime).toBeGreaterThan(initialAnimation.currentTime);
  await expect(page.getByText("流式回复完成", { exact: true })).toBeVisible();
});

test("does not show a tooltip for a truncated command title", async ({ page }) => {
  const command =
    "pnpm exec vitest run apps/web/src/features/workbench/components/task-timeline.test.tsx --testNamePattern tool-command-title-tooltip";
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
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
                outputTruncated: false,
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
  await expect(page.getByRole("link", { name: "OpenAI" })).toBeVisible();
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
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
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
  const conversation = page.getByRole("log", { name: "会话内容" });
  await expect(page.getByText(longDetail, { exact: true })).toBeVisible();
  expect(await conversation.evaluate((element) => element.scrollWidth)).toBe(
    await conversation.evaluate((element) => element.clientWidth),
  );
});
