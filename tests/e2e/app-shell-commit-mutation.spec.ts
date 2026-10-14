import { expect, parseRequestRecord, projectGitStatus, test } from "./fixtures/app-shell.js";

test("reviews selected files, preserves AI drafts and recovers a failed push", async ({ page }) => {
  const snapshot = "c".repeat(64);
  const generatedMessage = "feat(git): 生成选中文件提交\n\n- 添加提交正文";
  const additionalChanges = Array.from({ length: 16 }, (_, index) => ({
    diff: `+export const generated${String(index + 1)} = true;`,
    kind: "create" as const,
    path: `apps/web/src/generated-${String(index + 1).padStart(2, "0")}.ts`,
  }));
  let status = {
    ...projectGitStatus,
    snapshot,
    unstaged: [...projectGitStatus.unstaged, ...additionalChanges],
  };
  let head = "f".repeat(40);
  let pushed = false;
  let messageRequest: Record<string, unknown> | undefined;
  let commitRequest: Record<string, unknown> | undefined;
  let commitIdempotencyKey: string | undefined;
  const remoteState = () => ({
    head,
    upstream: "origin/feat/review-targets",
    remote: "origin",
    targetBranch: "feat/review-targets",
    remotes: [{ name: "origin", url: "https://example.com/repo.git" }],
    ahead: pushed ? 0 : 1,
    behind: 0,
    checkedAt: "2026-10-14T00:00:00Z",
    operation: "none",
    conflicts: [],
  });
  await page.route("**/v1/projects/codexly/git/status*", async (route) => {
    await route.fulfill({ contentType: "application/json", json: status });
  });
  await page.route("**/v1/projects/codexly/git/commit-message?*", async (route) => {
    messageRequest = parseRequestRecord(route.request().postData());
    await route.fulfill({
      contentType: "application/json",
      json: { message: generatedMessage, snapshot },
    });
  });
  await page.route("**/v1/projects/codexly/git/push?*", async (route) => {
    const request = parseRequestRecord(route.request().postData());
    if (request["action"] === "push") pushed = true;
    await route.fulfill({
      contentType: "application/json",
      json: {
        branch: status.branch,
        pushStatus: pushed ? "pushed" : "checked",
        pushError: null,
        remoteState: remoteState(),
      },
    });
  });
  await page.route("**/v1/projects/codexly/git/commits?*", async (route) => {
    commitRequest = parseRequestRecord(route.request().postData());
    commitIdempotencyKey = route.request().headers()["idempotency-key"];
    head = "0123456789abcdef0123456789abcdef01234567";
    status = { ...status, snapshot: "d".repeat(64), unstaged: additionalChanges };
    await route.fulfill({
      contentType: "application/json",
      status: 201,
      json: {
        branch: status.branch,
        commitSha: head,
        message: commitRequest["message"],
        pushError: "[rejected] non-fast-forward",
        pushStatus: "failed",
        status,
        history: {
          branch: status.branch,
          commits: [],
          nextCursor: null,
          repositories: [],
          repository: null,
          repositoryMode: "root",
        },
      },
    });
  });
  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("tab", { name: "项目" }).click();
  await page.getByRole("button", { name: "提交 17 个未提交变更" }).click();
  const inspector = page.locator(".workbench-inspector");
  const panel = inspector.locator('[data-slot="commit-changes-panel"]');
  const changesTab = inspector.getByRole("tab", { name: "变更" });
  const tree = panel.getByRole("tree", { name: "变更" });
  const all = tree.getByRole("checkbox", { name: "变更", exact: true });
  const generate = panel.getByRole("button", { name: "AI 生成" });
  const message = panel.getByRole("textbox", { name: "提交信息", exact: true });
  await expect(panel).toContainText("feat/review-targets");
  await expect(panel.getByRole("button", { name: "推送", exact: true })).toBeVisible();
  await expect(generate).toHaveText("AI 生成");
  await expect(all).toBeChecked();
  // 文件点击仅打开差异；返回后选择仍在，底部草稿不会重新初始化。
  await tree.getByRole("treeitem", { name: "package.json", exact: true }).click();
  await expect(inspector.getByRole("tab", { name: "Diff: package.json" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await inspector.getByRole("button", { name: "关闭文件" }).click();
  await changesTab.click();
  await expect(all).toBeChecked();
  await all.uncheck();
  await tree.getByRole("checkbox", { name: "变更: package.json", exact: true }).check();
  await generate.click();
  await expect(message).toHaveValue("feat(git): 生成选中文件提交");
  const description = panel.getByRole("textbox", { name: "详细描述", exact: true });
  await expect(description).toHaveValue("- 添加提交正文");
  await message.fill("feat(git): 保留手写信息");
  await generate.click();
  await expect(panel.getByText("AI 建议", { exact: true })).toBeVisible();
  await expect(message).toHaveValue("feat(git): 保留手写信息");
  await panel.getByRole("button", { name: "保留原文" }).click();
  await message.fill("feat(git): 提交选中文件");
  await description.fill("");
  await page.getByRole("tab", { name: "项目", exact: true }).click();
  await changesTab.click();
  await expect(message).toHaveValue("feat(git): 提交选中文件");
  await expect(
    tree.getByRole("checkbox", { name: "变更: package.json", exact: true }),
  ).toBeChecked();
  await panel.getByRole("button", { name: "更多 Git 操作" }).click();
  await page.getByRole("menuitem", { name: "提交并推送" }).click();
  await expect(panel.getByText("提交已保存，推送未完成", { exact: false })).toBeVisible();
  await expect(panel.getByRole("alert")).toContainText("远端包含尚未整合的提交");
  await expect(panel.getByRole("button", { name: "获取远端更新", exact: true })).toBeVisible();
  await expect(message).toHaveValue("");
  expect(messageRequest).toEqual({ expectedSnapshot: snapshot, paths: ["package.json"] });
  expect(commitRequest).toEqual({
    action: "commit_and_push",
    expectedSnapshot: snapshot,
    message: "feat(git): 提交选中文件",
    paths: ["package.json"],
  });
  expect(commitIdempotencyKey).toBeTruthy();
  await panel.getByRole("button", { name: "重试推送", exact: true }).click();
  await expect(panel.getByRole("button", { name: "已同步", exact: true })).toBeDisabled();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole("button", { name: "展开上下文面板" }).click();
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
