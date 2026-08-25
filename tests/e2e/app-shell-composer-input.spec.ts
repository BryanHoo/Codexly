import { expect, taskSnapshot, taskSnapshotResponse, test } from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("keeps composer attachment icons aligned with the compact toolbar", async ({ page }) => {
  await page.goto("/p/codexly/t/task-1");

  const attachmentButton = page.getByRole("button", { name: "添加图片或文件" });
  await expect(attachmentButton).toHaveCSS("height", "28px");
  await expect(attachmentButton.locator("svg")).toHaveCSS("width", "14px");
  await expect(attachmentButton.locator("svg")).toHaveCSS("height", "14px");

  await attachmentButton.click();
  const imageMenuIcon = page.getByRole("menuitem", { name: "添加图片" }).locator("svg");
  await expect(imageMenuIcon).toHaveCSS("width", "16px");
  await expect(imageMenuIcon).toHaveCSS("height", "16px");
});

test("shows every mobile composer action in full on one row", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/p/codexly/t/task-1");

  const approvalSelect = page.getByRole("combobox", { name: "批准模式" });
  const sandboxSelect = page.getByRole("combobox", { name: "沙盒模式" });
  const modelSelector = page.getByRole("button", { name: /^模型和思考量：/u });
  const submitButton = page.getByRole("button", { exact: true, name: "提交" });
  const controls = [approvalSelect, sandboxSelect, modelSelector, submitButton];
  const boxes = await Promise.all(controls.map((control) => control.boundingBox()));

  expect(boxes.every((box) => box !== null)).toBe(true);
  expect(new Set(boxes.map((box) => Math.round(box?.y ?? 0))).size).toBe(1);
  await expect(approvalSelect).toHaveCSS("field-sizing", "content");
  await expect(sandboxSelect).toHaveCSS("field-sizing", "content");
  expect(boxes[0]?.width).toBeGreaterThan(44);
  expect(boxes[1]?.width).toBeGreaterThan(44);
  expect(
    await modelSelector
      .locator("span")
      .first()
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  const footerSize = await approvalSelect.locator("xpath=../..").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(footerSize.scrollWidth).toBeLessThanOrEqual(footerSize.clientWidth);
});

test("switches composer task settings without success toasts", async ({ page }) => {
  await page.goto("/p/codexly/t/task-1");
  const successToast = page.locator('[data-sonner-toast][data-type="success"]');
  const waitForSettingsUpdate = () =>
    page.waitForResponse(
      (response) => response.url().endsWith("/tasks/task-1/settings") && response.ok(),
    );

  const approvalUpdate = waitForSettingsUpdate();
  await page.getByRole("combobox", { name: "批准模式" }).selectOption("never");
  await approvalUpdate;
  await expect(successToast).toHaveCount(0);

  const sandboxUpdate = waitForSettingsUpdate();
  await page.getByRole("combobox", { name: "沙盒模式" }).selectOption("danger-full-access");
  await sandboxUpdate;
  await expect(successToast).toHaveCount(0);

  const modelSelector = page.getByRole("button", { name: /^模型和思考量：/u });
  await modelSelector.click();
  await page.getByRole("menuitem", { name: "选择模型" }).click();
  const modelUpdate = waitForSettingsUpdate();
  await page.getByRole("menuitemradio", { name: /GPT-5\.6 Terra/u }).click();
  await modelUpdate;
  await expect(successToast).toHaveCount(0);

  await modelSelector.click();
  await page.getByRole("menuitem", { name: "选择思考量" }).click();
  const reasoningUpdate = waitForSettingsUpdate();
  await page.getByRole("menuitemradio", { name: /低/u }).click();
  await reasoningUpdate;
  await expect(successToast).toHaveCount(0);
});

test("navigates absolute paths and toggles hidden files in the host file picker", async ({
  page,
}) => {
  const hostFileQueries: URL[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/v1/host-files") hostFileQueries.push(url);
  });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/p/codexly/t/task-1");

  await page.getByRole("button", { name: "添加图片或文件" }).click();
  await page.getByRole("menuitem", { name: "添加文件" }).click();
  const dialog = page.getByRole("dialog", { name: "选择本机文件" });
  const pathInput = dialog.getByRole("textbox", { name: "绝对目录路径" });
  await expect(pathInput).toHaveValue("/Users/bryan/Attachments");
  await expect(dialog.getByRole("treeitem", { name: ".secret.pdf", exact: true })).toHaveCount(0);

  await pathInput.fill("/Users/bryan/HiddenDocs");
  await pathInput.press("Enter");
  await expect(dialog.getByRole("treeitem", { name: "notes.pdf", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "显示隐藏文件" }).click();
  await expect(dialog.getByRole("treeitem", { name: ".secret.pdf", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "隐藏隐藏文件" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  expect(
    hostFileQueries.some(
      (url) =>
        url.searchParams.get("path") === "/Users/bryan/HiddenDocs" &&
        url.searchParams.get("includeHidden") === null,
    ),
  ).toBe(true);
  expect(
    hostFileQueries.some(
      (url) =>
        url.searchParams.get("path") === "/Users/bryan/HiddenDocs" &&
        url.searchParams.get("includeHidden") === "true",
    ),
  ).toBe(true);
  const toolbar = pathInput.locator("..").locator("..");
  const toolbarMetrics = await toolbar.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(toolbarMetrics.scrollWidth).toBeLessThanOrEqual(toolbarMetrics.clientWidth);
});

test("undoes text pasted into the composer", async ({ page }) => {
  await page.goto("/p/codexly/t/task-1");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.click();
  await page.evaluate(async () => {
    await navigator.clipboard.writeText("需要撤销的内容");
  });
  await prompt.press(process.platform === "darwin" ? "Meta+v" : "Control+v");
  await expect(prompt).toHaveAttribute("data-serialized-value", "需要撤销的内容");

  await prompt.press(process.platform === "darwin" ? "Meta+z" : "Control+z");

  await expect(prompt).toHaveAttribute("data-serialized-value", "");
});

test("recalls submitted prompt history with arrow keys and restores the draft", async ({
  page,
}) => {
  const latestTurn = {
    completedAt: "2026-08-10T08:01:00.000Z",
    error: null,
    id: "turn-latest-history",
    items: [
      {
        id: "message-latest-history",
        role: "user" as const,
        text: "最近一次输入",
        type: "message" as const,
      },
    ],
    startedAt: "2026-08-10T08:00:00.000Z",
    status: "completed" as const,
  };
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: { ...taskSnapshot, turns: [...taskSnapshot.turns, latestTurn] },
      },
    });
  });
  await page.goto("/p/codexly/t/task-1");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await prompt.fill("尚未提交的草稿");

  await prompt.press("ArrowUp");
  await expect(prompt).toHaveAttribute("data-serialized-value", "最近一次输入");
  await prompt.press("ArrowUp");
  await expect(prompt).toHaveAttribute(
    "data-serialized-value",
    "$review-security 完成 macOS 原生风格的三栏工作台页面。",
  );
  await prompt.press("ArrowDown");
  await expect(prompt).toHaveAttribute("data-serialized-value", "最近一次输入");
  await prompt.press("ArrowDown");
  await expect(prompt).toHaveAttribute("data-serialized-value", "尚未提交的草稿");
});

test("does not submit or select a command when Safari confirms an IME candidate @smoke", async ({
  page,
}) => {
  const turnRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname === "/v1/projects/codexly/tasks/task-1/turns") {
      turnRequests.push(url.pathname);
    }
  });
  await page.goto("/p/codexly/t/task-1");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  const dispatchSafariImeEnter = () =>
    prompt.evaluate((editor) => {
      editor.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: editor.textContent }),
      );
      // Safari 在候选确认后会产生 isComposing=false、keyCode=229 的 Enter keydown。
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
          keyCode: 229,
        }),
      );
    });

  await prompt.fill("中文候选");
  await dispatchSafariImeEnter();
  await expect(prompt).toHaveAttribute("data-serialized-value", "中文候选");
  expect(turnRequests).toHaveLength(0);

  await prompt.fill("/");
  const commandMenu = page.getByRole("listbox", { name: "输入命令" });
  await expect(commandMenu).toBeVisible();
  await dispatchSafariImeEnter();
  await expect(commandMenu).toBeVisible();
  await expect(prompt).toHaveAttribute("data-serialized-value", "/");
  expect(turnRequests).toHaveLength(0);
});

test("shows processing state while an existing task turn is still starting", async ({ page }) => {
  let releaseTurnStart!: () => void;
  let markTurnStartRequested!: () => void;
  const turnStartGate = new Promise<void>((resolve) => {
    releaseTurnStart = resolve;
  });
  const turnStartRequested = new Promise<void>((resolve) => {
    markTurnStartRequested = resolve;
  });
  await page.route("**/v1/projects/codexly/tasks/task-1/turns", async (route) => {
    markTurnStartRequested();
    await turnStartGate;
    await route.fulfill({
      contentType: "application/json",
      json: {
        taskId: "task-1",
        turn: {
          completedAt: null,
          error: null,
          id: "turn-pending-start",
          items: [],
          startedAt: "2026-08-02T00:00:00.000Z",
          status: "running",
        },
      },
      status: 201,
    });
  });
  await page.goto("/p/codexly/t/task-1");

  await page.getByRole("textbox", { name: "任务输入" }).fill("继续处理当前任务");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await turnStartRequested;

  await expect(page.locator("[data-turn-processing-time]")).toHaveCount(2);
  await expect(page.getByLabel("AI 回复正在运行")).toBeVisible();

  releaseTurnStart();
  await expect(page.getByText("继续处理当前任务", { exact: true })).toBeVisible();
});

test("toggles the completed execution process from the processing time", async ({ page }) => {
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshot,
          turns: [
            {
              completedAt: "2026-08-06T00:00:08.000Z",
              error: null,
              id: "turn-collapsed-process",
              items: [
                {
                  id: "message-process-commentary",
                  phase: "commentary",
                  role: "assistant",
                  text: "正在读取项目配置。",
                  type: "message",
                },
                {
                  id: "tool-process-read",
                  input: { path: "package.json" },
                  name: "read_file",
                  output: "TOOL_OUTPUT_VISIBLE",
                  status: "completed",
                  type: "tool",
                },
                {
                  command: "pnpm check",
                  cwd: "/workspace/Codexly",
                  exitCode: 0,
                  id: "command-process-check",
                  output: "Checks passed",
                  outputOmitted: { bytes: 0, lines: 0 },
                  status: "completed",
                  type: "command",
                },
                {
                  id: "message-process-final",
                  phase: "final_answer",
                  role: "assistant",
                  text: "实现与检查已完成。",
                  type: "message",
                },
              ],
              startedAt: "2026-08-06T00:00:00.000Z",
              status: "completed",
            },
          ],
          updatedAt: "2026-08-06T00:00:08.000Z",
        },
      },
    });
  });
  await page.goto("/p/codexly/t/task-1");

  await expect(page.getByText("实现与检查已完成。", { exact: true })).toBeVisible();
  await expect(page.getByText("正在读取项目配置。", { exact: true })).toHaveCount(0);
  await expect(page.getByText("read_file", { exact: true })).toHaveCount(0);
  await expect(page.getByText("pnpm check", { exact: true })).toHaveCount(0);
  await expect(page.locator("[data-operation-group]")).toHaveCount(0);

  const expandProcess = page.getByRole("button", { name: "展开执行过程" });
  await expect(expandProcess).toHaveAttribute("aria-expanded", "false");
  await expandProcess.click();

  await expect(page.getByText("正在读取项目配置。", { exact: true })).toBeVisible();
  await expect(page.getByText("read_file", { exact: true })).toBeVisible();
  await expect(page.getByText("pnpm check", { exact: true })).toBeVisible();
  await expect(page.locator("[data-operation-group]")).toHaveCount(0);
  const collapseProcess = page.getByRole("button", { name: "收起执行过程" });
  await expect(collapseProcess).toHaveAttribute("aria-expanded", "true");
  await collapseProcess.click();

  await expect(page.getByText("正在读取项目配置。", { exact: true })).toHaveCount(0);
  await expect(page.getByText("read_file", { exact: true })).toHaveCount(0);
  await expect(page.getByText("pnpm check", { exact: true })).toHaveCount(0);
});

test("summarizes terminal operations after assistant text resumes", async ({ page }) => {
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
              completedAt: null,
              error: null,
              id: "turn-operation-summary",
              items: [
                {
                  id: "tool-operation-read",
                  input: { path: "package.json" },
                  name: "read_file",
                  output: "TOOL_OUTPUT_VISIBLE",
                  status: "completed",
                  type: "tool",
                },
                {
                  command: "pnpm check",
                  cwd: "/workspace/Codexly",
                  exitCode: 0,
                  id: "command-operation-check",
                  output: "Checks passed",
                  outputOmitted: { bytes: 0, lines: 0 },
                  status: "completed",
                  type: "command",
                },
                {
                  id: "message-operation-commentary",
                  phase: "commentary",
                  role: "assistant",
                  text: "继续处理。",
                  type: "message",
                },
              ],
              startedAt: "2026-08-06T00:00:00.000Z",
              status: "running",
            },
          ],
          updatedAt: "2026-08-06T00:00:08.000Z",
        },
      },
    });
  });
  await page.goto("/p/codexly/t/task-1");

  const operationSummary = page.locator("[data-operation-group] > summary");
  await expect(operationSummary).toContainText("操作完成：调用 1 个工具，执行 1 条命令");
  await expect(operationSummary).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("read_file", { exact: true })).toHaveCount(0);
  await expect(page.getByText("pnpm check", { exact: true })).toHaveCount(0);

  await operationSummary.click();
  await expect(operationSummary).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("read_file", { exact: true })).toBeVisible();
  await expect(page.getByText("pnpm check", { exact: true })).toBeVisible();
  await expect(page.getByText(/TOOL_OUTPUT_VISIBLE/u)).toHaveCount(0);

  await page.getByText("read_file", { exact: true }).click();
  await expect(page.getByText(/TOOL_OUTPUT_VISIBLE/u)).toBeVisible();
  await operationSummary.click();
  await expect(page.getByText("read_file", { exact: true })).toHaveCount(0);
});
