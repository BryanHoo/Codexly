import type {
  ScheduledTaskAttachmentRecord,
  ScheduledTaskAttachmentRepository,
  ScheduledTaskRepository,
} from "@codexly/core";
import {
  AgentMessageAttachmentSchema,
  ScheduledTaskSchema,
  type ScheduledTask,
} from "@codexly/protocol";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const ScheduledTaskArraySchema = Type.Array(ScheduledTaskSchema);

export function parseScheduledTaskSnapshot(value: string): readonly ScheduledTask[] {
  const tasks: unknown = JSON.parse(value);
  if (!Value.Check(ScheduledTaskArraySchema, tasks)) {
    throw new Error("Persisted scheduled tasks are invalid");
  }
  return tasks;
}

export function serializeScheduledTaskSnapshot(tasks: readonly ScheduledTask[]): string {
  if (!Value.Check(ScheduledTaskArraySchema, tasks)) {
    throw new Error("Scheduled tasks are invalid");
  }
  return JSON.stringify(tasks);
}

export function parseScheduledTaskAttachment(value: unknown): ScheduledTaskAttachmentRecord {
  if (typeof value !== "object" || value === null) {
    throw new Error("Persisted scheduled task attachment is invalid");
  }
  const row = value as Record<string, unknown>;
  const attachment = {
    id: row["attachment_id"],
    kind: row["kind"],
    mediaType: row["media_type"],
    name: row["name"],
    size: row["size"],
  };
  if (
    !Value.Check(AgentMessageAttachmentSchema, attachment) ||
    typeof row["project_id"] !== "string" ||
    typeof row["task_id"] !== "string" ||
    !(row["content"] instanceof Uint8Array) ||
    row["content"].byteLength !== attachment.size
  ) {
    throw new Error("Persisted scheduled task attachment is invalid");
  }
  return {
    attachment,
    content: row["content"],
    projectId: row["project_id"],
    taskId: row["task_id"],
  };
}

export abstract class SqliteScheduledTaskRepository
  implements ScheduledTaskRepository, ScheduledTaskAttachmentRepository
{
  protected abstract callScheduledTaskWorker<TResult>(
    operation: string,
    payload?: unknown,
  ): Promise<TResult>;

  public async listScheduledTasks(): Promise<readonly ScheduledTask[]> {
    return parseScheduledTaskSnapshot(
      await this.callScheduledTaskWorker<string>("readScheduledTasks"),
    );
  }

  public async replaceScheduledTasks(
    tasks: readonly ScheduledTask[],
  ): Promise<readonly ScheduledTask[]> {
    await this.callScheduledTaskWorker("writeScheduledTasks", {
      tasksJson: serializeScheduledTaskSnapshot(tasks),
    });
    return tasks;
  }

  public async deleteScheduledTaskAttachments(taskId: string): Promise<void> {
    await this.callScheduledTaskWorker("deleteScheduledTaskAttachments", { taskId });
  }

  public async listScheduledTaskAttachments(
    taskId: string,
  ): Promise<readonly ScheduledTaskAttachmentRecord[]> {
    const rows = await this.callScheduledTaskWorker<unknown[]>("listScheduledTaskAttachments", {
      taskId,
    });
    return rows.map(parseScheduledTaskAttachment);
  }

  public async readScheduledTaskAttachment(
    projectId: string,
    attachmentId: string,
  ): Promise<ScheduledTaskAttachmentRecord | undefined> {
    const row = await this.callScheduledTaskWorker<unknown>("readScheduledTaskAttachment", {
      attachmentId,
      projectId,
    });
    return row === undefined ? undefined : parseScheduledTaskAttachment(row);
  }

  public async replaceScheduledTaskAttachments(
    taskId: string,
    projectId: string,
    attachments: readonly Omit<ScheduledTaskAttachmentRecord, "projectId" | "taskId">[],
  ): Promise<void> {
    await this.callScheduledTaskWorker("replaceScheduledTaskAttachments", {
      attachments,
      projectId,
      taskId,
    });
  }
}
