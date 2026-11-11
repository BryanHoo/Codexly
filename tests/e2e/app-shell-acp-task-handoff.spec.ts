import { expect, test, taskSnapshotRoute } from "./fixtures/app-shell.js";

for (const width of [390, 1280]) {
  test(`ACP 首发权威快照接管、刷新查看及继续发送 ${String(width)}px @cross-browser`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem(
        "codeagent:engine-setup:v1",
        JSON.stringify({ engines: ["codex"], complete: true }),
      );
    });
    const legacyModels: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/v1/models") legacyModels.push(request.url());
    });
    await page.route("**/v1/capabilities", (route) =>
      route.fulfill({
        json: {
          runtime: "acp",
          provider: "codex",
          feedback: { upload: false },
          goals: { clear: false, read: false, update: false },
          skills: { list: false, use: false },
          tasks: { fork: false, list: true, read: true, start: true },
          turns: { compact: false, interrupt: true, review: false, start: true, steer: false },
        },
      }),
    );
    const session = {
      configOptions: [{ id: "raw", name: "原生配置", type: "boolean", currentValue: true }],
      availableCommands: [],
    };
    await page.route("**/v1/projects/codexly/acp/codex/preview", (route) =>
      route.fulfill({ json: { values: { raw: true }, configOptions: session.configOptions } }),
    );
    const task = {
      id: "acp-new",
      projectId: "codexly",
      title: "ACP 新会话",
      engine: "codex",
      pinned: false,
      updatedAt: "2026-11-10T00:00:00Z",
    };
    const turn = {
      id: "first",
      status: "running",
      items: [],
      startedAt: task.updatedAt,
      completedAt: null,
      error: null,
    };
    const checkpoint = { sequence: 0, sessionId: "e2e-session" };
    let reads = 0;
    await page.route(taskSnapshotRoute(task.id), (route) => {
      reads += 1;
      return route.fulfill({
        json: {
          checkpoint,
          snapshot: {
            ...task,
            runtime: "acp",
            status: "idle",
            contextUsage: null,
            goal: null,
            plan: null,
            pendingRequests: [],
            turnsNextCursor: null,
            acpSession: session,
            turns: [
              {
                ...turn,
                status: "completed",
                completedAt: task.updatedAt,
                items: [
                  { id: "user-first", type: "message", role: "user", text: "开始 ACP 任务" },
                  {
                    id: "reply-first",
                    type: "message",
                    role: "assistant",
                    text: "权威首屏已收到的正文",
                  },
                ],
              },
            ],
          },
        },
      });
    });
    await page.route("**/tasks/acp-new/acp/session", (route) => route.fulfill({ json: session }));
    const submissions: Record<string, unknown>[] = [];
    await page.route("**/v1/projects/codexly/submissions", (route) => {
      submissions.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({
        status: 201,
        json: {
          taskId: task.id,
          checkpoint: { sequence: 0, sessionId: checkpoint.sessionId },
          turn: { ...turn, id: submissions.length === 1 ? "first" : "second" },
          ...(submissions.length === 1 ? { createdTask: task } : {}),
        },
      });
    });
    await page.goto("/p/codexly");
    await page.getByRole("textbox", { name: "任务输入" }).fill("开始 ACP 任务");
    await page.getByRole("button", { name: "提交", exact: true }).click();
    await expect(page).toHaveURL(/\/p\/codexly\/t\/acp-new/u);
    await expect(page.getByText("权威首屏已收到的正文", { exact: true })).toBeVisible();
    expect(reads).toBeGreaterThanOrEqual(1);
    await page.reload();
    await expect(page.getByText("权威首屏已收到的正文", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "任务输入" }).fill("继续 ACP 任务");
    await page.getByRole("button", { name: "提交", exact: true }).click();
    await expect.poll(() => submissions.length).toBe(2);
    expect(submissions[1]).toMatchObject({
      type: "acp-prompt",
      taskId: task.id,
      input: { text: "继续 ACP 任务" },
    });
    expect(submissions[1]).not.toHaveProperty("options");
    expect(legacyModels).toEqual([]);
  });
}
