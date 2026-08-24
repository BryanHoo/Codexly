import { expect, parseRequestRecord, test } from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("runs official task actions from the slash command menu", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const commandRequests: { body: string | null; path: string }[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() === "POST" &&
      url.pathname.startsWith("/v1/projects/codexly/tasks/task-1/")
    ) {
      commandRequests.push({ body: request.postData(), path: url.pathname });
    }
  });
  await page.goto("/p/codexly/t/task-1");

  const historicalSkill = page.locator('[data-message-skill="review-security"]');
  const historicalInlineOffset = await historicalSkill.evaluate((token) => {
    const labelText = token.lastElementChild?.firstChild;
    const messageText = token.parentElement?.parentElement?.querySelector("p")?.firstChild;
    if (!(labelText instanceof Text) || !(messageText instanceof Text)) {
      throw new Error("Expected inline skill and message text nodes");
    }
    const labelRange = document.createRange();
    labelRange.selectNodeContents(labelText);
    const messageRange = document.createRange();
    messageRange.selectNodeContents(messageText);
    return labelRange.getBoundingClientRect().top - messageRange.getBoundingClientRect().top;
  });
  expect(Math.abs(historicalInlineOffset)).toBeLessThanOrEqual(1);

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.fill("第一行");
  await prompt.press("End");
  // 浏览器流程验证修饰键换行的真实 DOM 插入，平台键位映射由组件单元测试覆盖。
  await prompt.press("Control+Enter");
  await page.keyboard.type("第二行");
  await expect(prompt).toHaveAttribute("data-serialized-value", "第一行\n第二行");

  await prompt.fill("");
  await prompt.fill("/");
  const commandMenu = page.getByRole("listbox", { name: "输入命令" });
  await expect(commandMenu).toBeVisible();
  expect(await commandMenu.evaluate((menu) => menu.closest("form") === null)).toBe(true);
  await expect(commandMenu.getByRole("option")).toHaveCount(8);
  await expect(commandMenu.getByRole("option", { name: /代码审查/u })).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(commandMenu.getByRole("option", { name: /Documentation writer/u })).toBeVisible();
  await prompt.press("Escape");
  await expect(commandMenu).toBeHidden();
  await expect(page.getByRole("button", { name: "收起项目侧栏" })).toBeVisible();
  await expect(page.getByRole("button", { name: "收起上下文面板" })).toBeVisible();

  await prompt.fill("");
  await prompt.fill("/");
  await expect(commandMenu).toBeVisible();
  await page.getByRole("main", { name: "任务时间线" }).click({ position: { x: 10, y: 10 } });
  await expect(commandMenu).toBeHidden();

  await prompt.fill("");
  await prompt.fill("/");
  await expect(commandMenu).toBeVisible();
  const skillDescription = commandMenu.getByText(/review-security/u);
  await expect
    .poll(() =>
      skillDescription.evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.overflow, style.textOverflow, style.whiteSpace];
      }),
    )
    .toEqual(["hidden", "ellipsis", "nowrap"]);
  for (const label of ["初始化", "压缩", "复制", "计划"]) {
    await expect(commandMenu.getByRole("option", { name: new RegExp(label, "u") })).toBeVisible();
  }
  await expect(commandMenu.getByRole("option", { name: /副任务|反馈/u })).toHaveCount(0);

  for (let movementIndex = 0; movementIndex < 7; movementIndex += 1) {
    await prompt.press("ArrowDown");
  }
  await expect(commandMenu.getByRole("option", { name: /Documentation writer/u })).toHaveAttribute(
    "data-active",
    "true",
  );

  await prompt.fill("说明/security");
  await expect(commandMenu).toBeHidden();
  await prompt.fill("说明 /security");
  await expect(commandMenu).toBeVisible();
  await prompt.press("Enter");
  const selectedSkill = prompt.locator('[data-prompt-skill-id="skill-security"]');
  await expect(selectedSkill).toContainText("Security review");
  await expect(selectedSkill).toHaveAttribute("data-serialized-text", "$review-security");
  await expect(prompt).toHaveAttribute("data-serialized-value", "说明 $review-security");
  const caretAnchor = await prompt.evaluate((editor) => {
    const selection = document.getSelection();
    const anchorNode = selection?.anchorNode;
    return {
      anchorOffset: selection?.anchorOffset,
      anchoredAfterSkill:
        anchorNode instanceof Node &&
        editor.contains(anchorNode) &&
        anchorNode.parentElement?.dataset["promptCaretAnchor"] !== undefined &&
        anchorNode.parentElement.previousElementSibling?.matches("[data-prompt-skill-id]") === true,
    };
  });
  // Safari 会把根节点边界选区绘制到行首，末尾 Token 必须使用可编辑文本锚点承载光标。
  expect(caretAnchor).toEqual({ anchorOffset: 1, anchoredAfterSkill: true });
  const editorBaselineOffset = await selectedSkill.evaluate((token) => {
    const labelText = token.lastElementChild?.firstChild;
    const adjacentText = token.previousSibling;
    if (!(labelText instanceof Text) || !(adjacentText instanceof Text)) {
      throw new Error("Expected adjacent editor text nodes");
    }
    const labelRange = document.createRange();
    labelRange.selectNodeContents(labelText);
    const textRange = document.createRange();
    textRange.selectNodeContents(adjacentText);
    return labelRange.getBoundingClientRect().top - textRange.getBoundingClientRect().top;
  });
  expect(Math.abs(editorBaselineOffset)).toBeLessThanOrEqual(1);
  await page.keyboard.type(" /documentation");
  await expect(commandMenu).toBeVisible();
  await prompt.press("Enter");
  const selectedDocumentationSkill = prompt.locator('[data-prompt-skill-id="skill-docs"]');
  await expect(selectedDocumentationSkill).toContainText("Documentation writer");
  await expect(prompt).toHaveAttribute(
    "data-serialized-value",
    "说明 $review-security $documentation-writer",
  );
  // 浏览器快捷键跟随运行平台，确保 macOS、Linux 和 Windows 都能完成全选复制。
  const primaryModifier = process.platform === "darwin" ? "Meta" : "Control";
  await prompt.press(`${primaryModifier}+a`);
  await prompt.press(`${primaryModifier}+c`);
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("说明 $review-security $documentation-writer");
  const skillColors = await selectedSkill.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--ui-color-accent)";
    document.body.append(probe);
    const colors = {
      expected: getComputedStyle(probe).color,
      selected: getComputedStyle(element).color,
    };
    probe.remove();
    return colors;
  });
  expect(skillColors.selected).toBe(skillColors.expected);
  await selectedSkill.click();
  await expect(selectedSkill).toBeHidden();
  await expect(selectedDocumentationSkill).toBeVisible();
  await prompt.focus();
  await prompt.press("End");
  const endCaretAnchor = await prompt.evaluate((editor) => {
    const selection = document.getSelection();
    const anchorNode = selection?.anchorNode;
    return {
      anchorOffset: selection?.anchorOffset,
      anchoredAfterSkill:
        anchorNode instanceof Node &&
        editor.contains(anchorNode) &&
        anchorNode.parentElement?.dataset["promptCaretAnchor"] !== undefined &&
        anchorNode.parentElement.previousElementSibling?.matches("[data-prompt-skill-id]") === true,
    };
  });
  expect(endCaretAnchor).toEqual({ anchorOffset: 1, anchoredAfterSkill: true });
  await prompt.press("Backspace");
  await expect(selectedDocumentationSkill).toBeHidden();

  await prompt.fill("/压缩");
  await prompt.press("Enter");
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveText(
    "正在压缩上下文",
  );
  await expect
    .poll(() => commandRequests.map((request) => request.path))
    .toContain("/v1/projects/codexly/tasks/task-1/compact");

  await page.setViewportSize({ width: 390, height: 844 });
  await prompt.fill("/");
  await expect(page.getByRole("listbox", { name: "输入命令" })).toBeVisible();
  const viewportMetrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(viewportMetrics.documentWidth).toBeLessThanOrEqual(viewportMetrics.viewportWidth);

  await prompt.fill("/复制");
  await prompt.press("Enter");
  await expect(page).toHaveURL(/\/p\/codexly\/t\/task-2$/u);
  await expect
    .poll(() => commandRequests.map((request) => request.path))
    .toContain("/v1/projects/codexly/tasks/task-1/fork");
});

test("recognizes typed Codex skill references before submission", async ({ page }) => {
  let turnRequest: Record<string, unknown> | undefined;
  await page.route("**/v1/projects/codexly/tasks/task-1/turns", async (route) => {
    turnRequest = parseRequestRecord(route.request().postData());
    await route.fulfill({
      contentType: "application/json",
      json: {
        taskId: "task-1",
        turn: {
          completedAt: null,
          error: null,
          id: "typed-skill-turn",
          items: [],
          startedAt: "2026-08-09T00:00:00.000Z",
          status: "running",
        },
      },
    });
  });
  await page.goto("/p/codexly/t/task-1");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.fill("/");
  await expect(page.getByRole("option", { name: /Security review/u })).toBeVisible();
  await prompt.fill("");
  await prompt.fill("$review-security 其他需求");
  await expect(prompt.locator('[data-prompt-skill-id="skill-security"]')).toContainText(
    "Security review",
  );
  await expect(prompt).toHaveAttribute("data-serialized-value", "$review-security 其他需求");
  await prompt.press("Enter");

  await expect.poll(() => turnRequest).toBeDefined();
  expect(turnRequest?.["input"]).toEqual({
    attachments: [],
    skills: [{ id: "skill-security", name: "review-security" }],
    text: "其他需求",
    type: "prompt",
  });
});

test("selects and submits a project file reference from an inline @ mention", async ({ page }) => {
  let turnRequest: Record<string, unknown> | undefined;
  const fileSearchQueries: string[] = [];
  const fileSearchSessionIds: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/v1/projects/codexly/files/search") {
      fileSearchQueries.push(url.searchParams.get("query") ?? "");
      fileSearchSessionIds.push(url.searchParams.get("sessionId") ?? "");
    }
  });
  await page.route("**/v1/projects/codexly/tasks/task-1/turns", async (route) => {
    turnRequest = parseRequestRecord(route.request().postData());
    await route.fulfill({
      contentType: "application/json",
      json: {
        taskId: "task-1",
        turn: {
          completedAt: null,
          error: null,
          id: "file-reference-turn",
          items: [],
          startedAt: "2026-08-10T00:00:00.000Z",
          status: "running",
        },
      },
      status: 201,
    });
  });
  await page.goto("/p/codexly/t/task-1");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.fill("请检查 ");
  await page.keyboard.type("@main", { delay: 20 });
  const fileMenu = page.getByRole("listbox", { name: "搜索项目文件" });
  await expect(fileMenu).toBeVisible();
  await expect(fileMenu.getByRole("option")).toHaveCount(2);
  expect(fileSearchQueries).toEqual(["main"]);
  expect(fileSearchSessionIds).toHaveLength(1);
  expect(fileSearchSessionIds[0]).toMatch(/^[0-9a-f-]{36}$/u);
  await expect(fileMenu.getByRole("option").first()).toContainText("src");
  const stopRequestPromise = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/v1/projects/codexly/files/search/stop",
  );
  await prompt.press("Enter");

  const fileToken = prompt.locator('[data-prompt-file-path="src/main.tsx"]');
  await expect(fileToken).toBeVisible();
  const stopRequest = await stopRequestPromise;
  expect(parseRequestRecord(stopRequest.postData())["sessionId"]).toBe(fileSearchSessionIds[0]);
  await page.keyboard.type("读取文件");
  await expect(prompt).toHaveAttribute(
    "data-serialized-value",
    "请检查 @/workspace/Codexly/src/main.tsx读取文件",
  );
  await page.getByRole("button", { exact: true, name: "提交" }).click();

  await expect.poll(() => turnRequest).toBeDefined();
  expect(turnRequest?.["input"]).toEqual({
    attachments: [],
    skills: [],
    text: "请检查 @/workspace/Codexly/src/main.tsx 读取文件",
    type: "prompt",
  });
  const submittedMessage = page.locator('article[data-role="user"]').last();
  await expect(submittedMessage).toContainText("请检查");
  await expect(
    submittedMessage.locator('[data-prompt-file-reference="/workspace/Codexly/src/main.tsx"]'),
  ).toHaveText("main.tsx");
  await expect(submittedMessage).toContainText("读取文件");
});

test("从 AI 回复复制任务并保留到所属 Turn", async ({ page }) => {
  const forkRequests: Readonly<{ body: Record<string, unknown>; path: string }>[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname.endsWith("/fork")) {
      forkRequests.push({
        body: parseRequestRecord(request.postData()),
        path: url.pathname,
      });
    }
  });
  await page.goto("/p/codexly/t/task-1");

  const latestReply = page
    .locator('article[data-role="assistant"]')
    .filter({ hasText: "工作台界面已按统一的 项目 Agent 组件 结构重新组织。" });
  const copyMessageButton = latestReply.getByRole("button", { name: "复制消息" });
  await expect(copyMessageButton).toBeVisible();
  await expect(latestReply.getByRole("button", { name: "复制任务" })).toBeVisible();
  await copyMessageButton.hover();
  await expect(page.getByRole("tooltip")).toHaveText("复制消息");

  await latestReply.getByRole("button", { name: "复制任务" }).click();

  await expect
    .poll(() => forkRequests)
    .toContainEqual({
      body: { lastTurnId: "turn-1" },
      path: "/v1/projects/codexly/tasks/task-1/fork",
    });
  await expect(page).toHaveURL(/\/p\/codexly\/t\/task-2$/u);
});
