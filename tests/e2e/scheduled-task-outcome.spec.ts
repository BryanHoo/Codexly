import type { ScheduledTask } from "@codexly/protocol";
import { expect, test } from "./fixtures/app-shell.js";

for (const status of ["unknown", "cleanup_pending"] as const) {
  test(`blocks repeated scheduled launch for ${status} @cross-browser`, async ({ page }) => {
    const task: ScheduledTask = {
      id: "schedule-outcome",
      name: "巡检恢复",
      projectId: "codexly",
      projectName: "Codexly",
      enabled: false,
      messageAttachments: [],
      prompt: { type: "prompt", text: "检查变更", attachments: [], skills: [] },
      schedule: { type: "once", atUnixMs: Date.now() + 60_000 },
      turnOptions: {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
      createdAtUnixMs: Date.now(),
      updatedAtUnixMs: Date.now(),
      lastRunAtUnixMs: Date.now(),
      nextRunAtUnixMs: null,
      lastRunStatus: status,
      runs: [
        {
          id: "run-outcome",
          status,
          taskId: "task-a",
          error: null,
          startedAtUnixMs: Date.now(),
          finishedAtUnixMs: Date.now(),
        },
      ],
    };
    await page.route("**/v1/scheduled-tasks", (route) => route.fulfill({ json: { data: [task] } }));
    await page.routeWebSocket("**/v1/scheduled-tasks/events", (socket) => {
      socket.send(JSON.stringify({ type: "scheduled-tasks.changed" }));
    });
    await page.goto("/p/codexly/scheduled");
    await page.getByRole("button", { name: task.name, exact: true }).click();
    await expect(page.getByRole("button", { name: "立即运行", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "保存任务", exact: true })).toBeDisabled();
    await expect(
      page.getByText(
        status === "unknown"
          ? "启动结果尚未确认，已暂停再次运行。请先查看对应对话；确认后可删除此计划并重新创建。"
          : "任务已启动，正在重试资源清理，无需再次运行。",
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "task-a", exact: true })).toBeVisible();
  });
}
