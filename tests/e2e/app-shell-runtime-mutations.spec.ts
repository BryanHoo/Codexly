import { chooseHostAttachment, expect, test } from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("allows a command approval and completes the turn", async ({ page }) => {
  await page.unroute("**/v1/**");
  await page.goto("/p/code-agent");

  await page.getByRole("textbox", { name: "任务输入" }).fill("审批命令");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect(page.getByRole("region", { name: "命令审批请求" })).toBeVisible();
  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  await expect(sidebar.getByRole("status", { name: "任务等待审批" })).toBeVisible();
  const allow = page.getByRole("button", { exact: true, name: "允许" });
  await expect(allow).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.getByText("流式回复完成", { exact: true })).toBeVisible();
  await expect(sidebar.getByRole("status", { name: "任务等待审批" })).toHaveCount(0);
  await expect(page.getByLabel("Turn 1")).toHaveAttribute("data-status", "completed");
});

test("denies a file change approval and completes the turn", async ({ page }) => {
  await page.unroute("**/v1/**");
  await page.goto("/p/code-agent");

  await page.getByRole("textbox", { name: "任务输入" }).fill("审批文件");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect(page.getByRole("region", { name: "文件变更审批请求" })).toBeVisible();
  await page.getByRole("button", { exact: true, name: "拒绝" }).click();

  await expect(page.getByText("流式回复完成", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Turn 1")).toHaveAttribute("data-status", "completed");
});

test("answers a user input request and completes the turn", async ({ page }) => {
  await page.unroute("**/v1/**");
  await page.goto("/p/code-agent");

  await page.getByRole("textbox", { name: "任务输入" }).fill("用户输入");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect(page.getByRole("heading", { name: "需要你的输入" })).toBeVisible();
  await page.getByRole("radio", { name: /继续/ }).check();
  await page.getByRole("button", { exact: true, name: "提交回答" }).click();

  await expect(page.getByText("执行模式: 继续", { exact: true })).toBeVisible();
  await expect(page.getByText("流式回复完成", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Turn 1")).toHaveAttribute("data-status", "completed");
});

test("interrupts a running turn from the composer", async ({ page }) => {
  await page.unroute("**/v1/**");
  await page.goto("/p/code-agent");

  await page.getByRole("textbox", { name: "任务输入" }).fill("等待中断");
  await page.getByRole("button", { exact: true, name: "提交" }).click();

  await expect(page).toHaveURL(/\/p\/code-agent\/t\/task-action-\d+$/);
  await page.getByRole("button", { exact: true, name: "停止" }).click();
  await expect(page.getByLabel("Turn 1")).toHaveAttribute("data-status", "interrupted");
  await expect(page.getByRole("button", { exact: true, name: "提交" })).toBeVisible();
});

test("ignores repeated interrupt clicks while the request is in flight", async ({ page }) => {
  await page.unroute("**/v1/**");
  const idempotencyKeys: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/turns\/[^/]+\/interrupt$/u.test(request.url())) {
      idempotencyKeys.push(request.headers()["idempotency-key"] ?? "");
    }
  });
  await page.goto("/p/code-agent");

  await page.getByRole("textbox", { name: "任务输入" }).fill("等待中断");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect(page).toHaveURL(/\/p\/code-agent\/t\/task-action-\d+$/);

  const stopButton = page.getByRole("button", { exact: true, name: "停止" });
  await expect(stopButton).toBeEnabled();
  await stopButton.evaluate((button) => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  await expect.poll(() => idempotencyKeys).toHaveLength(1);
  expect(idempotencyKeys[0]).toBeTruthy();
});

test("preserves the prompt draft when submission fails", async ({ page }) => {
  await page.route("**/v1/projects/code-agent/attachments/image/host", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        attachment: {
          id: "attachment-preserved",
          kind: "image",
          mediaType: "image/png",
          name: "preserved.png",
          size: 68,
        },
      },
      status: 201,
    });
  });
  await page.route("**/v1/projects/code-agent/tasks", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { code: "PROVIDER_ERROR", message: "Agent provider request failed", retryable: true },
      status: 502,
    });
  });
  await page.goto("/p/code-agent");
  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await chooseHostAttachment(page, "image", "preserved.png");

  await prompt.fill("失败后保留这段草稿");
  await page.getByRole("button", { exact: true, name: "提交" }).click();

  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveText(
    "Agent provider request failed",
  );
  await expect(prompt).toHaveAttribute("data-serialized-value", "失败后保留这段草稿");
  await expect(page.getByText("preserved.png", { exact: true })).toBeVisible();
});
