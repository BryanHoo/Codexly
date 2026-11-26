import { chooseHostAttachment, enableLanAccess, expect, test } from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("interrupts a running turn from the composer", async ({ page }) => {
  await page.unroute("**/v1/**");
  await page.goto("/p/codexly");

  await page.getByRole("textbox", { name: "任务输入" }).fill("等待中断");
  await page.getByRole("button", { exact: true, name: "提交" }).click();

  await expect(page).toHaveURL(/\/p\/codexly\/t\/[\da-f-]{36}$/);
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
  await page.goto("/p/codexly");

  await page.getByRole("textbox", { name: "任务输入" }).fill("等待中断");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect(page).toHaveURL(/\/p\/codexly\/t\/[\da-f-]{36}$/);

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
  await enableLanAccess(page);
  await page.route("**/v1/projects/codexly/attachments/image/host", async (route) => {
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
  await page.route("**/v1/projects/codexly/submissions", async (route) => {
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
  await page.goto("/p/codexly");
  const prompt = page.getByRole("textbox", { name: "任务输入" });
  await chooseHostAttachment(page, "image", "preserved.png");

  await prompt.fill("失败后保留这段草稿");
  await page.getByRole("button", { exact: true, name: "提交" }).click();

  await expect(page.locator('[data-toast][data-type="error"]')).toHaveText(
    "Agent provider request failed",
  );
  await expect(prompt).toHaveAttribute("data-serialized-value", "失败后保留这段草稿");
  await expect(page.getByText("preserved.png", { exact: true })).toBeVisible();
});
