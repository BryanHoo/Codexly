import { expect, mockAppShellApi, parseRequestRecord, test } from "./fixtures/app-shell.js";

test("creates and restores a temporary task without exposing its internal project", async ({
  page,
}) => {
  // 显式安装，避免多文件 worker 的模块加载顺序影响该独立契约场景。
  await mockAppShellApi(page);
  const requestedPaths: string[] = [];
  let temporaryTurnOptions: Record<string, unknown> | undefined;
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    requestedPaths.push(pathname);
    if (request.method() === "POST" && /^\/v1\/temporary\/tasks\/[^/]+\/turns$/u.test(pathname)) {
      const body = parseRequestRecord(request.postData());
      temporaryTurnOptions = parseRequestRecord(JSON.stringify(body["options"]));
    }
  });

  await page.goto("/temporary");

  const sidebar = page.getByRole("complementary", { name: "项目侧栏" });
  await expect(sidebar.getByRole("link", { name: "新建任务" })).toBeVisible();
  const temporaryGroup = sidebar.getByRole("region", { name: "临时任务" });
  await expect(temporaryGroup.getByRole("button", { name: "新建任务" })).toBeVisible();

  const input = page.getByRole("textbox", { name: "任务输入" });
  const approvalSelect = page.getByRole("combobox", { name: "批准模式" });
  const sandboxSelect = page.getByRole("combobox", { name: "沙盒模式" });
  await expect(approvalSelect).toBeEnabled();
  await expect(sandboxSelect).toHaveValue("workspace-write");
  await approvalSelect.selectOption("auto-review");
  await input.fill("/");
  await expect(page.getByRole("option", { name: /Security review/u })).toBeVisible();
  await expect(page.getByRole("option", { name: /代码审查/u })).toHaveCount(0);
  await expect(page.getByRole("option", { name: /初始化/u })).toHaveCount(0);
  await expect(page.getByRole("option", { name: /压缩/u })).toBeVisible();
  await expect(page.getByRole("option", { name: /计划/u })).toBeVisible();
  await input.fill("解释这段临时需求");
  await page.getByRole("button", { exact: true, name: "提交" }).click();

  await expect(page).toHaveURL(/\/temporary\/t\/temporary-task-1$/u);
  await expect(page.getByText("解释这段临时需求", { exact: true })).toBeVisible();
  await expect(page.getByText("临时回复：解释这段临时需求", { exact: true })).toBeVisible();
  const changedFiles = page.getByRole("region", { name: "本次修改了 1 个文件" });
  await changedFiles.getByRole("button", { name: "审核", exact: true }).click();
  const reviewDialog = page.getByRole("dialog", { name: "temporary-change.ts" });
  await expect(reviewDialog).toBeVisible();
  await reviewDialog.getByRole("button", { name: "关闭文件审核" }).click();
  await changedFiles
    .getByRole("button", { name: "已编辑 temporary-change.ts，新增 1 行，删除 1 行" })
    .click();
  const diffDialog = page.getByRole("dialog", { name: "temporary-change.ts" });
  await expect(diffDialog).toBeVisible();
  await diffDialog.getByRole("button", { name: "关闭文件 Diff" }).click();
  await page.getByRole("button", { name: "temporary-note.md" }).click();
  const sourceDialog = page.getByRole("dialog", { name: "temporary-note.md" });
  await expect(sourceDialog).toContainText("允许从临时任务打开");
  await sourceDialog.getByRole("button", { name: "关闭源文件" }).click();
  await page.getByRole("button", { name: "temporary-preview.png" }).click();
  const imageDialog = page.getByRole("dialog", { name: "temporary-preview.png" });
  await expect(imageDialog.getByRole("img", { name: "temporary-preview.png" })).toHaveAttribute(
    "src",
    "/v1/temporary/files/image?path=%2Ftmp%2Ftemporary-preview.png",
  );
  await imageDialog.getByRole("button", { name: "关闭图片预览" }).click();
  await page.getByRole("button", { name: "temporary-report.pdf" }).click();
  await expect
    .poll(() => requestedPaths.filter((path) => path === "/v1/temporary/open").length)
    .toBe(1);
  await expect(approvalSelect).toHaveValue("auto-review");
  expect(temporaryTurnOptions?.["sandboxMode"]).toBe("workspace-write");
  const inspector = page.getByRole("complementary", { name: "运行环境" });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole("tablist")).toHaveCount(0);
  await expect(inspector.getByRole("region", { name: "MCP" })).toContainText("context7");
  await expect(page.getByText("temporary-workspace")).toHaveCount(0);

  await page.reload();

  await expect(page.getByText("临时回复：解释这段临时需求", { exact: true })).toBeVisible();
  await input.fill("继续补充约束");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect(page.getByText("临时回复：继续补充约束", { exact: true })).toBeVisible();

  const main = page.getByRole("main", { name: "任务时间线" });
  await main.getByRole("button", { name: "重命名任务 临时任务会话" }).click();
  const renameDialog = page.getByRole("dialog", { name: "重命名任务" });
  await renameDialog.getByRole("textbox", { name: "任务名称" }).fill("临时排查记录");
  await renameDialog.getByRole("button", { name: "保存" }).click();
  await expect(main.getByRole("heading", { name: "临时排查记录" })).toBeVisible();

  const temporaryGroupToggle = temporaryGroup.getByRole("button", { name: "临时任务" });
  await temporaryGroupToggle.click();
  await expect(temporaryGroupToggle).toHaveAttribute("aria-expanded", "false");
  await expect(temporaryGroup.getByRole("link", { name: /临时排查记录/u })).toHaveCount(0);
  await page.reload();
  await expect(temporaryGroupToggle).toHaveAttribute("aria-expanded", "false");
  await expect(temporaryGroup.getByRole("link", { name: /临时排查记录/u })).toHaveCount(0);
  await temporaryGroupToggle.click();
  await expect(temporaryGroupToggle).toHaveAttribute("aria-expanded", "true");

  await temporaryGroup.getByRole("link", { name: /临时排查记录/u }).hover();
  await temporaryGroup.getByRole("button", { name: "打开 临时排查记录 的操作菜单" }).click();
  await page.getByRole("menuitem", { name: "归档" }).click();

  await expect(page).toHaveURL(/\/temporary$/u);
  await expect(temporaryGroup.getByText("临时排查记录", { exact: true })).toHaveCount(0);
  expect(requestedPaths.some((path) => path.startsWith("/v1/projects/temporary"))).toBe(false);
  expect(requestedPaths.some((path) => path.startsWith("/v1/temporary"))).toBe(true);
});

test("permanently deletes a temporary task through its public route", async ({ page }) => {
  const requestedPaths: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "DELETE") {
      requestedPaths.push(new URL(request.url()).pathname);
    }
  });
  await page.goto("/temporary");

  const input = page.getByRole("textbox", { name: "任务输入" });
  await input.fill("待永久删除的临时任务");
  await page.getByRole("button", { exact: true, name: "提交" }).click();
  await expect(page).toHaveURL(/\/temporary\/t\/temporary-task-1$/u);

  const temporaryGroup = page.getByRole("region", { name: "临时任务" });
  const taskLink = temporaryGroup.getByRole("link", { name: /临时任务会话/u });
  await taskLink.hover();
  await temporaryGroup.getByRole("button", { name: "打开 临时任务会话 的操作菜单" }).click();
  await page.getByRole("menuitem", { name: "永久删除" }).click();
  await page
    .getByRole("dialog", { name: "永久删除任务" })
    .getByRole("button", { name: "永久删除" })
    .click();

  await expect(page).toHaveURL(/\/temporary$/u);
  await expect(temporaryGroup.getByText("临时任务会话", { exact: true })).toHaveCount(0);
  expect(requestedPaths).toEqual(["/v1/temporary/tasks/temporary-task-1"]);
});
