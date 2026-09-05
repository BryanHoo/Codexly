import { Readable } from "node:stream";

import type {
  ScheduledTaskAttachmentRecord,
  ScheduledTaskAttachmentRepository,
} from "@codexly/core";
import type { AgentMessageAttachment, AgentPromptInput, ScheduledTask } from "@codexly/protocol";

import { AttachmentNotFoundError, type AttachmentStore } from "./attachment-store.js";

function sameAttachment(left: AgentMessageAttachment, right: AgentMessageAttachment): boolean {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.mediaType === right.mediaType &&
    left.name === right.name &&
    left.size === right.size
  );
}

export class ScheduledTaskAttachmentManager {
  readonly #attachmentStore: AttachmentStore;
  readonly #repository: ScheduledTaskAttachmentRepository;

  public constructor(
    attachmentStore: AttachmentStore,
    repository: ScheduledTaskAttachmentRepository,
  ) {
    this.#attachmentStore = attachmentStore;
    this.#repository = repository;
  }

  public async persist(task: ScheduledTask): Promise<void> {
    const references = new Set(task.prompt.attachments.map((attachment) => attachment.id));
    const metadata = new Map(
      task.messageAttachments.map((attachment) => [attachment.id, attachment]),
    );
    if (
      references.size !== task.prompt.attachments.length ||
      metadata.size !== references.size ||
      [...references].some((id) => !metadata.has(id))
    ) {
      throw new Error("Scheduled task attachment metadata is incomplete");
    }
    const existing = new Map(
      (await this.#repository.listScheduledTaskAttachments(task.id)).map((record) => [
        record.attachment.id,
        record,
      ]),
    );
    const attachments = await Promise.all(
      task.messageAttachments.map(async (attachment) => {
        let record: Omit<ScheduledTaskAttachmentRecord, "projectId" | "taskId">;
        try {
          const stored = await this.#attachmentStore.read(task.projectId, attachment.id);
          record = { attachment: stored.attachment, content: stored.content };
        } catch (error) {
          if (!(error instanceof AttachmentNotFoundError)) throw error;
          const stored = existing.get(attachment.id);
          if (stored === undefined) throw error;
          record = { attachment: stored.attachment, content: stored.content };
        }
        if (!sameAttachment(record.attachment, attachment)) {
          throw new Error("Scheduled task attachment metadata does not match stored content");
        }
        return record;
      }),
    );
    // 附件集合整批替换，编辑任务时不会遗留已移除的二进制内容。
    await this.#repository.replaceScheduledTaskAttachments(task.id, task.projectId, attachments);
  }

  public delete(taskId: string): Promise<void> {
    return this.#repository.deleteScheduledTaskAttachments(taskId);
  }

  public read(
    projectId: string,
    attachmentId: string,
  ): Promise<ScheduledTaskAttachmentRecord | undefined> {
    return this.#repository.readScheduledTaskAttachment(projectId, attachmentId);
  }

  public async restorePrompt(
    task: ScheduledTask,
  ): Promise<Readonly<{ prompt: AgentPromptInput; restoredIds: readonly string[] }>> {
    if (task.prompt.attachments.length === 0) return { prompt: task.prompt, restoredIds: [] };
    const records = new Map(
      (await this.#repository.listScheduledTaskAttachments(task.id)).map((record) => [
        record.attachment.id,
        record,
      ]),
    );
    const restoredIds: string[] = [];
    try {
      const attachments = [];
      for (const reference of task.prompt.attachments) {
        const record = records.get(reference.id);
        if (record === undefined) throw new Error("Scheduled task attachment was not found");
        const upload = await this.#attachmentStore.add(task.projectId, {
          content: Readable.from([record.content]),
          kind: record.attachment.kind,
          mediaType: record.attachment.mediaType,
          name: record.attachment.name,
        });
        restoredIds.push(upload.attachment.id);
        attachments.push({ id: upload.attachment.id });
      }
      return { prompt: { ...task.prompt, attachments }, restoredIds };
    } catch (error) {
      await this.discard(restoredIds);
      throw error;
    }
  }

  public async discard(ids: readonly string[]): Promise<void> {
    await Promise.all(ids.map((id) => this.#attachmentStore.discard(id)));
  }
}
