import { expect, taskSnapshot, taskSnapshotResponse, test } from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("restores network approvals from the task snapshot after refresh", async ({ page }) => {
  let resolutionCount = 0;
  const pendingRequest = {
    availableDecisions: ["allow", "deny"],
    command: "pnpm check",
    createdAt: "2026-07-23T00:00:00.000Z",
    cwd: "/workspace/Codexly",
    expiresAt: null,
    itemId: "command-approval-1",
    kind: "command",
    networkAccess: { host: "api.example.com", protocol: "https" },
    projectId: "codexly",
    reason: "需要执行检查",
    requestId: "string:snapshot-request",
    status: "pending",
    taskId: "task-1",
    turnId: "turn-1",
    type: "command_approval",
  };
  await page.route(
    "**/v1/projects/codexly/tasks/task-1/pending-requests/*/resolve",
    async (route) => {
      resolutionCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
      await route.fulfill({
        contentType: "application/json",
        json: { request: { ...pendingRequest, status: "resolved" } },
      });
    },
  );
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: { ...taskSnapshot, pendingRequests: [pendingRequest], status: "running" },
      },
    });
  });

  await page.goto("/p/codexly/t/task-1");
  const approval = page.getByRole("region", { name: "网络访问审批请求" });
  await expect(approval).toBeVisible();
  await expect(approval).toContainText("api.example.com");
  await expect(approval).toContainText("HTTPS");

  await page.reload();
  await expect(page.getByRole("region", { name: "网络访问审批请求" })).toBeVisible();
  const allow = page.getByRole("button", { exact: true, name: "允许" });
  await expect(allow).toBeEnabled();
  await expect(allow).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => resolutionCount).toBe(1);
  await expect(allow).toBeDisabled();
});

test("disables user input controls while an answer is being submitted", async ({ page }) => {
  const pendingRequest = {
    createdAt: "2026-07-23T00:00:00.000Z",
    expiresAt: null,
    itemId: "user-input-1",
    projectId: "codexly",
    questions: [
      {
        header: "执行模式",
        id: "mode",
        isOther: false,
        isSecret: false,
        options: [
          { description: "继续实现", label: "继续" },
          { description: "停止当前工作", label: "停止" },
        ],
        prompt: "下一步怎么处理？",
        type: "choice",
      },
    ],
    requestId: "string:user-input-1",
    status: "pending",
    taskId: "task-1",
    turnId: "turn-1",
    type: "user_input",
  };
  await page.route(
    "**/v1/projects/codexly/tasks/task-1/pending-requests/*/resolve",
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await route.fulfill({
        contentType: "application/json",
        json: { request: { ...pendingRequest, status: "resolved" } },
      });
    },
  );
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: { ...taskSnapshot, pendingRequests: [pendingRequest], status: "running" },
      },
    });
  });

  await page.goto("/p/codexly/t/task-1");
  const continueAnswer = page.getByRole("radio", { name: /继续/ });
  const stopAnswer = page.getByRole("radio", { name: /停止/ });
  await continueAnswer.check();
  await page.getByRole("button", { name: "提交回答" }).click();

  await expect(continueAnswer).toBeDisabled();
  await expect(stopAnswer).toBeDisabled();
});

test("streams Fake App Server notifications into the Timeline @smoke", async ({ page }) => {
  await page.unroute("**/v1/**");
  await page.goto("/p/codexly/t/task-realtime");

  await expect(page.getByText("Realtime connected", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "上下文已使用 13%" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("启动子代理 · 1 个子代理已完成", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "上下文" })).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("region", { name: "MCP" }).getByText("context7", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看子代理 frontend_analysis 的输出" }),
  ).toBeVisible();
  await expect(page.getByText("理解前端项目", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "查看子代理 frontend_analysis 的输出" }).click();
  const subagentDialog = page.getByRole("dialog", { name: "子代理输出" });
  await expect(subagentDialog).toBeVisible();
  await expect(subagentDialog.getByText("正在分析前端", { exact: true })).toBeVisible();

  // 关闭弹窗会卸载子线程 Runtime；再次打开时从最新 Snapshot 继续，而非重启子代理。
  await page.getByRole("button", { name: "关闭子代理输出" }).click();
  await expect(subagentDialog).toHaveCount(0);
  await page.waitForTimeout(750);
  await page.getByRole("button", { name: "查看子代理 frontend_analysis 的输出" }).click();
  await expect(page.getByRole("dialog", { name: "子代理输出" })).toContainText("前端流式分析完成");
  await expect(page.getByText("agent/spawn", { exact: true })).toHaveCount(0);
});

test("shows MCP connection states and manually retries the current task", async ({ page }) => {
  let retries = 0;
  await page.route("**/v1/projects/codexly/tasks/task-1/mcp-servers", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        data: [
          {
            displayName: "Docs",
            name: "docs",
            status: "failed",
            toolCount: 0,
          },
          {
            displayName: "Context7",
            name: "context7",
            status: "connected",
            toolCount: 2,
          },
        ],
      },
    });
  });
  await page.route("**/v1/projects/codexly/tasks/task-1/mcp-servers/retry", async (route) => {
    retries += 1;
    await route.fulfill({
      contentType: "application/json",
      json: {
        data: [
          {
            displayName: "Docs",
            name: "docs",
            status: "starting",
            toolCount: 0,
          },
        ],
      },
    });
  });

  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("tab", { name: "上下文" }).click();
  const mcp = page.getByRole("region", { name: "MCP" });
  const reloadIcon = mcp.getByRole("button", { name: "重新加载 MCP" }).locator("svg");
  await expect
    .poll(() => reloadIcon.evaluate((icon) => icon.getBoundingClientRect().width))
    .toBeLessThanOrEqual(16);
  await expect(mcp.getByText("启动失败", { exact: false })).toBeVisible();
  await expect(mcp.getByText("已连接", { exact: false })).toBeVisible();
  await expect(mcp.getByText("Provider-only MCP description", { exact: true })).toHaveCount(0);
  await expect(mcp.getByRole("button", { name: "查看错误日志" })).toHaveCount(0);
  await mcp.getByRole("button", { name: "重新加载 MCP" }).click();
  await expect.poll(() => retries).toBe(1);
  await expect(mcp.getByText("正在启动", { exact: false })).toBeVisible();
});

test("hides the MCP module when the request fails before data is available", async ({ page }) => {
  await page.route("**/v1/projects/codexly/tasks/task-1/mcp-servers", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        code: "PROVIDER_ERROR",
        message: "mcpServerStatus/list failed: MCP server `docs` executable was not found",
        retryable: true,
      },
      status: 502,
    });
  });
  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("tab", { name: "上下文" }).click();
  await expect(page.getByRole("region", { name: "MCP" })).toHaveCount(0);
  await expect(
    page.getByText("mcpServerStatus/list failed: MCP server `docs` executable was not found"),
  ).toHaveCount(0);
});
