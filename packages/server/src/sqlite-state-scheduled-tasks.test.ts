import type { ScheduledTask } from "@codexly/protocol";
import { describe, expect, it } from "vitest";

import {
  openRepository,
  repositories,
  createWorkspace,
} from "./sqlite-state-repository.test-support.js";

describe("SQLite scheduled task state", () => {
  it("atomically replaces and restores scheduled task snapshots", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root);
    const task: ScheduledTask = {
      createdAtUnixMs: 1,
      enabled: false,
      id: "schedule-a",
      lastRunAtUnixMs: null,
      lastRunStatus: null,
      messageAttachments: [],
      name: "Review",
      nextRunAtUnixMs: null,
      projectId: "temporary",
      projectName: "Temporary task",
      prompt: { attachments: [], skills: [], text: "Review", type: "prompt" },
      runs: [],
      schedule: { atUnixMs: 2_000, type: "once" },
      turnOptions: {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
      updatedAtUnixMs: 1,
    };

    await expect(repository.replaceScheduledTasks([task])).resolves.toEqual([task]);
    const content = new Uint8Array([115, 99, 104, 101, 100, 117, 108, 101, 100]);
    const attachment = {
      id: "attachment-a",
      kind: "text" as const,
      mediaType: "text/plain" as const,
      name: "review.txt",
      size: content.byteLength,
    };
    await repository.replaceScheduledTaskAttachments(task.id, task.projectId, [
      { attachment, content },
    ]);
    await repository.close();
    repositories.splice(repositories.indexOf(repository), 1);

    const reopened = await openRepository(root);
    await expect(reopened.listScheduledTasks()).resolves.toEqual([task]);
    await expect(reopened.listScheduledTaskAttachments(task.id)).resolves.toEqual([
      { attachment, content, projectId: task.projectId, taskId: task.id },
    ]);
    await expect(
      reopened.readScheduledTaskAttachment(task.projectId, attachment.id),
    ).resolves.toMatchObject({ attachment, projectId: task.projectId, taskId: task.id });
  });
});
