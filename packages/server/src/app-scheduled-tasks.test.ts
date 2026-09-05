import type { ScheduledTaskAttachmentRepository } from "@codexly/core";
import type { ScheduledTask } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";

import { createCodexlyServer } from "./app.js";
import {
  closeCallbacks,
  createProvider,
  createServerOptions,
  project,
  turnOptions,
} from "./app-all.test-support.js";

describe("server scheduled tasks", () => {
  it("creates, toggles, runs and deletes scheduled tasks", async () => {
    let records: readonly ScheduledTask[] = [];
    const repository = {
      listScheduledTasks: vi.fn(() => Promise.resolve(records)),
      replaceScheduledTasks: vi.fn((tasks: readonly ScheduledTask[]) => {
        records = [...tasks];
        return Promise.resolve(records);
      }),
    };
    const { provider, startTask, startTurn } = createProvider();
    const app = await createCodexlyServer(
      createServerOptions(provider, { scheduledTaskRepository: repository }),
    );
    closeCallbacks.push(() => app.close());
    const input = {
      enabled: true,
      messageAttachments: [],
      name: "Daily review",
      projectId: project.id,
      projectName: project.name,
      prompt: { attachments: [], skills: [], text: "Review", type: "prompt" },
      schedule: { atUnixMs: Date.now() + 3_600_000, type: "once" },
      turnOptions,
    };

    const created = await app.inject({
      method: "POST",
      payload: input,
      url: "/v1/scheduled-tasks",
    });
    expect(created.statusCode).toBe(201);
    const taskId = created.json<{ task: ScheduledTask }>().task.id;
    expect((await app.inject({ method: "GET", url: "/v1/scheduled-tasks" })).json()).toMatchObject({
      data: [{ id: taskId }],
    });

    const toggled = await app.inject({
      method: "PATCH",
      payload: { enabled: false },
      url: `/v1/scheduled-tasks/${taskId}/enabled`,
    });
    expect(toggled.json()).toMatchObject({ task: { enabled: false, id: taskId } });
    const started = await app.inject({ method: "POST", url: `/v1/scheduled-tasks/${taskId}/run` });
    expect(started.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(startTurn).toHaveBeenCalledOnce();
    });
    expect(startTask).toHaveBeenCalledOnce();

    await vi.waitFor(async () => {
      const response = await app.inject({ method: "DELETE", url: `/v1/scheduled-tasks/${taskId}` });
      expect(response.statusCode).toBe(200);
    });
    expect((await app.inject({ method: "GET", url: "/v1/scheduled-tasks" })).json()).toEqual({
      data: [],
    });
  });

  it("does not create an orphan task when a persisted attachment is missing", async () => {
    const now = Date.now();
    const scheduled: ScheduledTask = {
      createdAtUnixMs: now,
      enabled: false,
      id: "schedule-with-missing-attachment",
      lastRunAtUnixMs: null,
      lastRunStatus: null,
      messageAttachments: [
        {
          id: "missing-attachment",
          kind: "text",
          mediaType: "text/plain",
          name: "missing.txt",
          size: 7,
        },
      ],
      name: "Review attachment",
      nextRunAtUnixMs: null,
      projectId: project.id,
      projectName: project.name,
      prompt: {
        attachments: [{ id: "missing-attachment" }],
        skills: [],
        text: "Review",
        type: "prompt",
      },
      runs: [],
      schedule: { atUnixMs: now + 3_600_000, type: "once" },
      turnOptions,
      updatedAtUnixMs: now,
    };
    let records: readonly ScheduledTask[] = [scheduled];
    const attachmentRepository: ScheduledTaskAttachmentRepository = {
      deleteScheduledTaskAttachments: () => Promise.resolve(),
      listScheduledTaskAttachments: () => Promise.resolve([]),
      readScheduledTaskAttachment: () => Promise.resolve(undefined),
      replaceScheduledTaskAttachments: () => Promise.resolve(),
    };
    const { provider, startTask } = createProvider();
    const app = await createCodexlyServer(
      createServerOptions(provider, {
        scheduledTaskAttachmentRepository: attachmentRepository,
        scheduledTaskRepository: {
          listScheduledTasks: () => Promise.resolve(records),
          replaceScheduledTasks: (tasks: readonly ScheduledTask[]) => {
            records = [...tasks];
            return Promise.resolve(records);
          },
        },
      }),
    );
    closeCallbacks.push(() => app.close());

    const response = await app.inject({
      method: "POST",
      url: `/v1/scheduled-tasks/${scheduled.id}/run`,
    });
    expect(response.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(records[0]?.lastRunStatus).toBe("failed");
    });
    expect(startTask).not.toHaveBeenCalled();
  });
});
