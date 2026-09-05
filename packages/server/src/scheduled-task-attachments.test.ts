import { Readable } from "node:stream";

import type {
  ScheduledTaskAttachmentRecord,
  ScheduledTaskAttachmentRepository,
} from "@codexly/core";
import type { ScheduledTask } from "@codexly/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { AttachmentStore } from "./attachment-store.js";
import { ScheduledTaskAttachmentManager } from "./scheduled-task-attachments.js";

const stores: AttachmentStore[] = [];

function createRepository(): ScheduledTaskAttachmentRepository {
  let records: readonly ScheduledTaskAttachmentRecord[] = [];
  return {
    deleteScheduledTaskAttachments: (taskId) => {
      records = records.filter((record) => record.taskId !== taskId);
      return Promise.resolve();
    },
    listScheduledTaskAttachments: (taskId) =>
      Promise.resolve(records.filter((record) => record.taskId === taskId)),
    readScheduledTaskAttachment: (projectId, attachmentId) =>
      Promise.resolve(
        records.find(
          (record) => record.projectId === projectId && record.attachment.id === attachmentId,
        ),
      ),
    replaceScheduledTaskAttachments: (taskId, projectId, attachments) => {
      records = [
        ...records.filter((record) => record.taskId !== taskId),
        ...attachments.map((record) => ({ ...record, projectId, taskId })),
      ];
      return Promise.resolve();
    },
  };
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.dispose()));
});

describe("ScheduledTaskAttachmentManager", () => {
  it("restores persisted prompt attachments into a fresh attachment store", async () => {
    const repository = createRepository();
    const initialStore = new AttachmentStore();
    stores.push(initialStore);
    const upload = await initialStore.add("project-a", {
      content: Readable.from(["scheduled content"]),
      kind: "text",
      mediaType: "text/plain",
      name: "review.txt",
    });
    const task: ScheduledTask = {
      createdAtUnixMs: 1,
      enabled: true,
      id: "schedule-a",
      lastRunAtUnixMs: null,
      lastRunStatus: null,
      messageAttachments: [upload.attachment],
      name: "Review",
      nextRunAtUnixMs: 2_000,
      projectId: "project-a",
      projectName: "Project A",
      prompt: {
        attachments: [{ id: upload.attachment.id }],
        skills: [],
        text: "Review",
        type: "prompt",
      },
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
    await new ScheduledTaskAttachmentManager(initialStore, repository).persist(task);

    const restoredStore = new AttachmentStore();
    stores.push(restoredStore);
    const manager = new ScheduledTaskAttachmentManager(restoredStore, repository);
    const restored = await manager.restorePrompt(task);
    const restoredId = restored.prompt.attachments[0]?.id;

    expect(restoredId).toBeDefined();
    expect(restoredId).not.toBe(upload.attachment.id);
    if (restoredId === undefined) throw new Error("Expected restored attachment id");
    const content = await restoredStore.read(task.projectId, restoredId);
    expect(content.content.toString()).toBe("scheduled content");
    await expect(manager.read(task.projectId, upload.attachment.id)).resolves.toMatchObject({
      attachment: upload.attachment,
      taskId: task.id,
    });
  });
});
