import { chooseHostAttachment, expect, test } from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("keeps pasted images in attachments instead of the text editor @cross-browser", async ({
  page,
}) => {
  await page.goto("/p/code-agent/t/task-1");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  const pasteWasCanceled = await prompt.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], "pasted.png", { type: "image/png" }),
    );
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    });
    if (event.clipboardData !== clipboardData) {
      // Firefox 忽略 ClipboardEventInit.clipboardData，测试需显式提供真实事件字段。
      Object.defineProperty(event, "clipboardData", { value: clipboardData });
    }

    return !element.dispatchEvent(event) && event.defaultPrevented;
  });

  await expect(page.getByText("pasted.png", { exact: true })).toBeVisible();
  await expect(prompt.locator("img")).toHaveCount(0);
  expect(pasteWasCanceled).toBe(true);
});

test("converts large pasted text into a submitted file attachment", async ({ page }) => {
  let uploadRequest:
    { contentType: string | undefined; postData: string | null; url: string } | undefined;
  let turnBody: unknown;
  await page.route("**/v1/projects/code-agent/attachments/*", async (route) => {
    const request = route.request();
    uploadRequest = {
      contentType: request.headers()["content-type"],
      postData: request.postData(),
      url: request.url(),
    };
    await route.fulfill({
      contentType: "application/json",
      json: {
        attachment: {
          id: "attachment-pasted-text",
          kind: "text",
          mediaType: "text/plain",
          name: "Pasted text.txt",
          size: 1_001,
        },
      },
      status: 201,
    });
  });
  await page.route("**/v1/projects/code-agent/tasks/task-1/turns", async (route) => {
    turnBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      json: {
        taskId: "task-1",
        turn: {
          completedAt: null,
          error: null,
          id: "turn-pasted-text",
          items: [],
          startedAt: "2026-08-01T00:00:00.000Z",
          status: "running",
        },
      },
      status: 201,
    });
  });
  await page.goto("/p/code-agent/t/task-1");

  const prompt = page.getByRole("textbox", { name: "任务输入" });
  const pasteResult = await prompt.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "x".repeat(1_001));
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    });

    const dispatchResult = element.dispatchEvent(event);
    return {
      clipboardTextLength: clipboardData.getData("text/plain").length,
      pasteWasCanceled: !dispatchResult && event.defaultPrevented,
    };
  });

  expect(pasteResult).toEqual({ clipboardTextLength: 1_001, pasteWasCanceled: true });
  await expect(prompt).toHaveAttribute("data-serialized-value", "");
  await expect(page.getByText("Pasted text.txt", { exact: true })).toBeVisible();

  await page.getByRole("button", { exact: true, name: "提交" }).click();
  const submittedAttachment = page.locator('[data-message-attachment="text"]');
  await expect(submittedAttachment).toBeVisible();
  await expect(submittedAttachment).toContainText("Pasted text.txt");
  await expect(submittedAttachment).toContainText("1001 B");
  await expect(submittedAttachment.locator("img")).toHaveCount(0);

  expect(uploadRequest?.url).toMatch(/\/attachments\/text$/u);
  expect(uploadRequest?.contentType).toMatch(/^multipart\/form-data; boundary=/u);
  expect(uploadRequest?.postData).toContain('name="attachment"; filename="Pasted text.txt"');
  expect(turnBody).toMatchObject({
    input: {
      attachments: [{ id: "attachment-pasted-text" }],
      text: "",
      type: "prompt",
    },
  });
});

test("submits host attachments, approval policy, model, and reasoning effort through the real client contract", async ({
  page,
}) => {
  let importRequest: { body: unknown; url: string } | undefined;
  let turnBody: unknown;
  const previewRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      request.url().endsWith("/v1/projects/code-agent/attachments/attachment-1")
    ) {
      previewRequests.push(request.url());
    }
  });
  await page.route("**/v1/projects/code-agent/attachments/image/host", async (route) => {
    const request = route.request();
    importRequest = {
      body: request.postDataJSON(),
      url: request.url(),
    };
    await route.fulfill({
      contentType: "application/json",
      json: {
        attachment: {
          id: "attachment-1",
          kind: "image",
          mediaType: "image/png",
          name: "screen.png",
          size: 68,
        },
      },
      status: 201,
    });
  });
  await page.route("**/v1/projects/code-agent/tasks/task-1/turns", async (route) => {
    turnBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      json: {
        taskId: "task-1",
        turn: {
          completedAt: null,
          error: null,
          id: "turn-attachment",
          items: [],
          startedAt: "2026-07-24T00:00:00.000Z",
          status: "running",
        },
      },
      status: 201,
    });
  });
  await page.goto("/p/code-agent/t/task-1");

  const modelSelector = page.getByRole("button", { name: /^模型和思考量：/u });
  await expect(modelSelector).toHaveAccessibleName("模型和思考量：GPT-5.6 Sol，高");
  await modelSelector.click();
  const selectorMenu = page.getByRole("menu", { name: "模型和思考量" });
  expect((await selectorMenu.boundingBox())?.width).toBeLessThanOrEqual(160);
  await page.getByRole("menuitem", { name: "选择模型" }).click();
  const modelMenu = page.getByRole("menu", { name: "选择模型" });
  await expect(modelMenu.getByRole("menuitemradio")).toHaveCount(2);
  await expect(modelMenu).not.toContainText("适合复杂编码任务");
  expect((await modelMenu.boundingBox())?.width).toBeLessThanOrEqual(160);
  await modelMenu.getByRole("menuitemradio", { name: /GPT-5\.6 Terra/u }).click();
  await expect(modelSelector).toHaveAccessibleName("模型和思考量：GPT-5.6 Terra，中");

  await modelSelector.click();
  await page.getByRole("menuitem", { name: "选择思考量" }).click();
  const reasoningMenu = page.getByRole("menu", { name: "选择思考量" });
  await expect(reasoningMenu.getByRole("menuitemradio")).toHaveCount(2);
  await expect(reasoningMenu.getByRole("menuitemradio")).toHaveText(["低", "中"]);
  expect((await reasoningMenu.boundingBox())?.width).toBeLessThanOrEqual(112);
  await reasoningMenu.getByRole("menuitemradio", { name: /低/u }).click();
  await expect(modelSelector).toHaveAccessibleName("模型和思考量：GPT-5.6 Terra，低");
  const approvalSelect = page.getByRole("combobox", { name: "批准模式" });
  const sandboxSelect = page.getByRole("combobox", { name: "沙盒模式" });
  await expect(approvalSelect.locator("xpath=following-sibling::select[1]")).toHaveAttribute(
    "aria-label",
    "沙盒模式",
  );
  await approvalSelect.selectOption("auto-review");
  await sandboxSelect.selectOption("danger-full-access");
  await chooseHostAttachment(page, "image", "screen.png");
  await expect(page.getByText("screen.png", { exact: true })).toBeVisible();
  await expect.poll(() => previewRequests).toHaveLength(1);
  const prompt = page.getByRole("textbox", { name: "任务输入" });
  const commandMenu = page.getByRole("listbox", { name: "输入命令" });
  await prompt.fill("/plan");
  await expect(commandMenu.getByRole("option", { name: /计划/u })).toBeVisible();
  await prompt.press("Enter");
  const planModeTag = page.getByRole("button", { name: "取消计划模式" });
  await expect(planModeTag).toBeVisible();
  await expect
    .poll(() =>
      sandboxSelect.evaluate(
        (element) => element.nextElementSibling?.hasAttribute("data-plan-mode") ?? false,
      ),
    )
    .toBe(true);
  await planModeTag.hover();
  await expect(planModeTag.locator("svg").last()).toHaveCSS("opacity", "1");
  await planModeTag.click();
  await expect(planModeTag).toHaveCount(0);
  await prompt.fill("/plan");
  await prompt.press("Enter");
  await expect(page.getByRole("button", { name: "取消计划模式" })).toBeVisible();
  await prompt.fill("/security");
  await expect(commandMenu.getByRole("option", { name: /Security review/u })).toBeVisible();
  await prompt.press("Enter");
  await expect(prompt.locator('[data-prompt-skill-id="skill-security"]')).toBeVisible();
  await prompt.focus();
  await prompt.press("End");
  await page.keyboard.type(" /documentation");
  await expect(commandMenu.getByRole("option", { name: /Documentation writer/u })).toBeVisible();
  await prompt.press("Enter");
  await expect(prompt.locator('[data-prompt-skill-id="skill-docs"]')).toBeVisible();
  await prompt.focus();
  await prompt.press("End");
  await page.keyboard.type(" 按截图完成改造");
  await page.getByRole("button", { exact: true, name: "提交" }).click();

  await expect(prompt).toHaveAttribute("data-serialized-value", "");
  await expect(prompt.locator("[data-prompt-skill-id]")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "消息编辑器" }).getByText("screen.png", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('[data-message-skill="documentation-writer"]')).toBeVisible();
  expect(importRequest?.url).toMatch(/\/attachments\/image\/host$/u);
  expect(importRequest?.body).toEqual({ path: "/Users/bryan/Attachments/screen.png" });
  expect(turnBody).toEqual({
    input: {
      attachments: [{ id: "attachment-1" }],
      skills: [
        { id: "skill-security", name: "review-security" },
        { id: "skill-docs", name: "documentation-writer" },
      ],
      text: "按截图完成改造",
      type: "prompt",
    },
    options: {
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      collaborationMode: "plan",
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
      sandboxMode: "danger-full-access",
    },
  });
});
