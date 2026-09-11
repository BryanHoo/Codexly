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
  it("posts schedule previews and validates the bounded response", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ dates: [2_000_000_000_000] }));
    const client = new CodexlyClient({ fetch: fetchMock });
    await expect(client.previewScheduledTask(task.schedule)).resolves.toEqual({
      dates: [2_000_000_000_000],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/scheduled-tasks/preview",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ schedule: task.schedule }),
      }),
    );
    fetchMock.mockResolvedValue(jsonResponse({ dates: Array.from({ length: 6 }, () => 1) }));
    await expect(client.previewScheduledTask(task.schedule)).rejects.toThrow();
  });
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
