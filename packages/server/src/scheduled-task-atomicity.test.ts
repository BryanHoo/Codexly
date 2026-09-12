import { join } from "node:path";
import { Readable } from "node:stream";
import Database from "better-sqlite3";
import type { ScheduledTaskInput } from "@codexly/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { turnOptions } from "./app.test-support.js";
import { AttachmentStore } from "./attachment-store.js";
import { ScheduledTaskAttachmentManager } from "./scheduled-task-attachments.js";
import { ScheduledTaskService } from "./scheduled-task-service.js";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const root = await createWorkspace();
  const repository = await openRepository(root);
  const database = new Database(join(root, "state.sqlite3"));
  cleanups.push(() => {
    database.close();
  });
  const store = new AttachmentStore();
  cleanups.push(() => store.dispose());
  const manager = new ScheduledTaskAttachmentManager(store, repository);
  const service = new ScheduledTaskService({
    prepareTaskResources: (task) => manager.prepare(task),
    repository,
    startTask: () => Promise.resolve("task-a"),
  });
  cleanups.push(() => service.close());
  await service.start();
  const upload = await store.add("temporary", {
    content: Readable.from(["original"]),
    kind: "text",
    mediaType: "text/plain",
    name: "review.txt",
  });
  const input: ScheduledTaskInput = {
    enabled: false,
    messageAttachments: [upload.attachment],
    name: "Review",
    projectId: "temporary",
    projectName: "Temporary",
    prompt: {
      attachments: [{ id: upload.attachment.id }],
      skills: [],
      text: "Review",
      type: "prompt",
    },
    schedule: { atUnixMs: Date.now() + 60_000, type: "once" },
    turnOptions,
  };
  return { attachmentId: upload.attachment.id, database, input, repository, root, service, store };
}

describe("scheduled task atomic persistence", () => {
  it("notifies only after both the task and attachment are visible to another connection", async () => {
    const { database, input, service } = await setup();
    const snapshots: number[] = [];
    service.subscribe(() => {
      snapshots.push(
        (
          database.prepare("SELECT count(*) AS count FROM scheduled_task_attachments").get() as {
            count: number;
          }
        ).count,
      );
    });
    await service.create(input);
    expect(snapshots).toEqual([1]);
  });

  it("does not publish or persist a task when attachment preparation fails", async () => {
    const { attachmentId, input, repository, service, store } = await setup();
    await store.discard(attachmentId);
    const changed = vi.fn();
    service.subscribe(changed);
    const write = vi.spyOn(repository, "replaceScheduledTasks");
    await expect(service.create(input)).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    await expect(repository.listScheduledTasks()).resolves.toEqual([]);
  });

  it("preserves durable attachments after upload expiry and removes only the edited or deleted task's resources", async () => {
    const { attachmentId, input, repository, root, service, store } = await setup();
    const first = await service.create(input);
    const second = await service.create(input);
    const original = await repository.listScheduledTaskAttachments(first.id);
    await store.discard(attachmentId);
    // 上传过期后编辑仍从持久附件准备数据，清空附件则在同次提交中删除旧内容。
    await service.update(first.id, { ...input, name: "Renamed" });
    await expect(repository.listScheduledTaskAttachments(first.id)).resolves.toEqual(original);
    await service.update(first.id, {
      ...input,
      messageAttachments: [],
      prompt: { ...input.prompt, attachments: [] },
    });
    await expect(repository.listScheduledTaskAttachments(first.id)).resolves.toEqual([]);
    await expect(repository.listScheduledTaskAttachments(second.id)).resolves.toHaveLength(1);
    await service.delete(second.id);
    await service.close();
    await repository.close();
    const reopened = await openRepository(root);
    await expect(reopened.listScheduledTasks()).resolves.toMatchObject([
      { id: first.id, messageAttachments: [] },
    ]);
    await expect(reopened.listScheduledTaskAttachments(first.id)).resolves.toEqual([]);
    await expect(reopened.listScheduledTaskAttachments(second.id)).resolves.toEqual([]);
  });

  it.each(["create", "update", "delete"] as const)(
    "rolls back %s and its attachments on SQL failure without notifying",
    async (operation) => {
      const { database, input, repository, root, service } = await setup();
      const task = operation === "create" ? undefined : await service.create(input);
      const previous = await repository.listScheduledTasks();
      const previousAttachments = task
        ? await repository.listScheduledTaskAttachments(task.id)
        : [];
      // 在真实 SQL 中注入失败，确保验证的是事务回滚，而不是应用层补偿写入。
      database.exec(`CREATE TRIGGER fail_attachment BEFORE ${operation === "delete" ? "DELETE" : "INSERT"}
      ON scheduled_task_attachments BEGIN SELECT RAISE(ABORT, 'attachment failure'); END`);
      const changed = vi.fn();
      service.subscribe(changed);
      const write = vi.spyOn(repository, "replaceScheduledTasks");
      const mutation = async () => {
        if (operation === "create") return service.create(input);
        if (task === undefined) throw new Error("Expected existing task");
        return operation === "update"
          ? service.update(task.id, { ...input, name: "Changed" })
          : service.delete(task.id);
      };
      await expect(mutation()).rejects.toThrow("attachment failure");
      expect(write).toHaveBeenCalledOnce();
      expect(changed).not.toHaveBeenCalled();
      await expect(service.list()).resolves.toEqual(previous);
      await expect(repository.listScheduledTasks()).resolves.toEqual(previous);
      await service.close();
      await repository.close();
      const reopened = await openRepository(root);
      await expect(reopened.listScheduledTasks()).resolves.toEqual(previous);
      if (task)
        await expect(reopened.listScheduledTaskAttachments(task.id)).resolves.toEqual(
          previousAttachments,
        );
      else expect(database.prepare("SELECT * FROM scheduled_task_attachments").all()).toEqual([]);
    },
  );
});
