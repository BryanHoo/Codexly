import { expect, parseRequestRecord, projectGitStatus, test } from "./fixtures/app-shell.js";

test("generates a message and commits only selected files", async ({ page }) => {
  const snapshot = "c".repeat(64);
  const generatedMessage = "feat(git): 生成选中文件提交\n\n- 添加提交正文";
  const additionalChanges = Array.from({ length: 16 }, (_, index) => ({
    diff: `+export const generated${String(index + 1)} = true;`,
    kind: "create",
    path: `apps/web/src/generated-${String(index + 1).padStart(2, "0")}.ts`,
  }));
  let messageRequest: Record<string, unknown> | undefined;
  let commitRequest: Record<string, unknown> | undefined;
  let commitIdempotencyKey: string | undefined;
  let historyRequestCount = 0;
  await page.route("**/v1/projects/codexly/git/status*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...projectGitStatus,
        snapshot,
        unstaged: [...projectGitStatus.unstaged, ...additionalChanges],
      },
    });
  });
  await page.route("**/v1/projects/codexly/git/commit-message?*", async (route) => {
    messageRequest = parseRequestRecord(route.request().postData());
    await route.fulfill({
      contentType: "application/json",
      json: { message: generatedMessage, snapshot },
    });
  });
  await page.route("**/v1/projects/codexly/git/commits?*", async (route) => {
    commitRequest = parseRequestRecord(route.request().postData());
    commitIdempotencyKey = route.request().headers()["idempotency-key"];
    await route.fulfill({
      contentType: "application/json",
      json: {
        branch: "feat/review-targets",
        commitSha: "0123456789abcdef0123456789abcdef01234567",
        message: commitRequest["message"],
        pushError: "fatal: remote rejected",
        pushStatus: "failed",
        status: { ...projectGitStatus, snapshot, unstaged: additionalChanges },
        history: {
          branch: "feat/review-targets",
          commits: [],
          nextCursor: null,
          repositories: [],
          repository: null,
          repositoryMode: "root",
        },
      },
      status: 201,
    });
  });
  await page.route("**/v1/projects/codexly/git/history*", async (route) => {
    historyRequestCount += 1;
    await route.fulfill({
      contentType: "application/json",
      json: {
        branch: "feat/review-targets",
        commits: [],
        nextCursor: null,
        repositories: [],
        repository: null,
        repositoryMode: "root",
      },
    });
  });

  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("button", { name: "提交 17 个未提交变更" }).click();
  const inspector = page.locator(".workbench-inspector");
  const changesTab = inspector.getByRole("tab", { name: "变更" });
  const panel = inspector.locator('[data-slot="commit-changes-panel"]');
  await expect(changesTab).toHaveAttribute("aria-selected", "true");
  await expect(panel).toBeVisible();
  await expect(page.locator('[data-slot="sheet-content"]')).toHaveCount(0);
  const unstagedTree = panel.getByRole("tree", { name: "未暂存" });
  const allFilesCheckbox = panel.getByRole("checkbox", { name: "未暂存", exact: true });
  const generateMessageButton = panel.getByRole("button", { name: "生成 message 信息" });
  await expect(allFilesCheckbox).toBeChecked();
  await expect(generateMessageButton).toHaveCSS("height", "28px");
  await expect(generateMessageButton).toHaveCSS("width", "28px");
  await expect(generateMessageButton).toHaveText("");
  const inputGroup = panel.locator('[data-slot="input-group"]');
  const generateIcon = generateMessageButton.locator("svg");
  const [inputGroupBox, generateButtonBox, generateIconBox] = await Promise.all([
    inputGroup.boundingBox(),
    generateMessageButton.boundingBox(),
    generateIcon.boundingBox(),
  ]);
  expect(
    Math.abs(
      (inputGroupBox?.x ?? 0) +
        (inputGroupBox?.width ?? 0) -
        (generateButtonBox?.x ?? 0) -
        (generateButtonBox?.width ?? 0),
    ),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      (generateButtonBox?.x ?? 0) +
        (generateButtonBox?.width ?? 0) / 2 -
        (generateIconBox?.x ?? 0) -
        (generateIconBox?.width ?? 0) / 2,
    ),
  ).toBeLessThanOrEqual(1);
  await generateMessageButton.hover();
  await expect(page.getByRole("tooltip")).toHaveText("生成 message 信息");
  const messageInput = panel.getByRole("textbox", { name: "提交信息" });
  await expect(messageInput).toHaveJSProperty("tagName", "TEXTAREA");
  await expect(messageInput).toHaveAttribute("rows", "1");
  const singleLineInputGroupHeight = (await inputGroup.boundingBox())?.height ?? 0;
  const changesScroll = panel.locator('[data-slot="commit-changes-scroll"]');
  const panelMetrics = await panel.evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
  }));
  await changesScroll.evaluate((element) => {
    // 模拟超长变更列表，验证滚动被限制在面板文件区域。
    const spacer = document.createElement("div");
    spacer.setAttribute("aria-hidden", "true");
    spacer.style.height = "1200px";
    element.append(spacer);
  });
  const changesScrollMetrics = await changesScroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return {
      clientHeight: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    };
  });
  expect(panelMetrics.scrollHeight).toBeLessThanOrEqual(panelMetrics.clientHeight);
  expect(panelMetrics.overflowY).toBe("hidden");
  expect(changesScrollMetrics.scrollHeight).toBeGreaterThan(changesScrollMetrics.clientHeight);
  expect(changesScrollMetrics.overflowY).toBe("auto");
  expect(changesScrollMetrics.scrollTop).toBeGreaterThan(0);
  expect(await panel.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(panel).not.toContainText("feat/review-targets");
  await expect(panel.getByText("当前分支历史")).toHaveCount(0);
  expect(historyRequestCount).toBe(0);

  const packageFile = unstagedTree.getByRole("treeitem", { name: "package.json" });
  await packageFile.click();
  const fileDiffDialog = page.getByRole("dialog", { name: "package.json" });
  await expect(fileDiffDialog).toBeVisible();
  await expect(fileDiffDialog.locator(".file-diff-renderer")).toContainText("pnpm run dev");
  await fileDiffDialog.getByRole("button", { name: "关闭文件 Diff" }).click();
  await expect(fileDiffDialog).not.toBeAttached();
  await expect(allFilesCheckbox).toBeChecked();

  await allFilesCheckbox.uncheck();
  const packageCheckbox = unstagedTree.getByRole("checkbox", {
    name: "未暂存: package.json",
  });
  await expect(packageCheckbox).not.toBeChecked();
  await packageCheckbox.check();
  await generateMessageButton.click();
  await expect(messageInput).toHaveValue(generatedMessage);
  await expect(messageInput).toHaveAttribute("rows", "3");
  expect((await inputGroup.boundingBox())?.height ?? 0).toBeGreaterThan(singleLineInputGroupHeight);
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
  await messageInput.fill("feat(git): 提交选中文件\n\n保留提交正文");
  const messageMetrics = await messageInput.evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
  }));
  expect(messageMetrics.scrollHeight).toBeGreaterThan(messageMetrics.clientHeight);
  expect(messageMetrics.overflowY).toBe("auto");
  await messageInput.fill("feat(git): 提交选中文件");
  await expect(panel.getByRole("button", { name: "提交", exact: true }).locator("svg")).toHaveCSS(
    "width",
    "16px",
  );
  await panel.getByRole("button", { name: "选择提交方式" }).click();
  await expect(page.getByRole("menuitem", { name: "提交并推送" }).locator("svg")).toHaveCSS(
    "width",
    "14px",
  );
  await page.getByRole("menuitem", { name: "提交并推送" }).click();

  await expect(panel.getByText("提交已完成，但推送失败")).toHaveCount(0);
  const pushErrorToast = page.locator('[data-sonner-toast][data-type="error"]');
  await expect(pushErrorToast).toHaveText("fatal: remote rejected");
  expect(messageRequest).toEqual({ expectedSnapshot: snapshot, paths: ["package.json"] });
  expect(commitRequest).toEqual({
    action: "commit_and_push",
    expectedSnapshot: snapshot,
    message: "feat(git): 提交选中文件",
    paths: ["package.json"],
  });
  expect(commitIdempotencyKey).toBeTruthy();
  expect(historyRequestCount).toBe(0);

  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole("button", { name: "展开上下文面板" }).click();
  const mobilePanel = page.locator('[data-slot="commit-changes-panel"]');
  await expect(mobilePanel).toBeVisible();
  expect(await mobilePanel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
});
