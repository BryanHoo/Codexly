import type { ScheduledTask } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";

import { CodexlyClient } from "./http-client.js";
import { jsonResponse } from "./http-client.test-support.js";

const task = {
  createdAtUnixMs: 1,
  enabled: true,
  id: "schedule/a",
  lastRunAtUnixMs: null,
  lastRunStatus: null,
  messageAttachments: [],
  name: "Review",
  nextRunAtUnixMs: 2_000_000_000_000,
  projectId: "temporary",
  projectName: "Temporary task",
  prompt: { attachments: [], skills: [], text: "Review", type: "prompt" },
  runs: [],
  schedule: { atUnixMs: 2_000_000_000_000, type: "once" },
  turnOptions: {
    approvalPolicy: "never",
    approvalsReviewer: "user",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    sandboxMode: "workspace-write",
  },
  updatedAtUnixMs: 1,
} as const satisfies ScheduledTask;

describe("CodexlyClient scheduled tasks", () => {
  it("calls and decodes every scheduled task endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [task] }))
      .mockResolvedValueOnce(jsonResponse({ task }))
      .mockResolvedValueOnce(jsonResponse({ task }))
      .mockResolvedValueOnce(jsonResponse({ task: { ...task, enabled: false } }))
      .mockResolvedValueOnce(jsonResponse({ task }))
      .mockResolvedValueOnce(jsonResponse({ status: "deleted", taskId: task.id }));
    const client = new CodexlyClient({ fetch: fetchMock });

    await client.listScheduledTasks();
    await client.createScheduledTask(task);
    await client.updateScheduledTask(task.id, task);
    await client.setScheduledTaskEnabled(task.id, false);
    await client.runScheduledTaskNow(task.id);
    await client.deleteScheduledTask(task.id);

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? "GET"])).toEqual([
      ["/v1/scheduled-tasks", "GET"],
      ["/v1/scheduled-tasks", "POST"],
      ["/v1/scheduled-tasks/schedule%2Fa", "PUT"],
      ["/v1/scheduled-tasks/schedule%2Fa/enabled", "PATCH"],
      ["/v1/scheduled-tasks/schedule%2Fa/run", "POST"],
      ["/v1/scheduled-tasks/schedule%2Fa", "DELETE"],
    ]);
  });
});
