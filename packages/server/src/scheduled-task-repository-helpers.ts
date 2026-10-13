import { setTimeout as delay } from "node:timers/promises";
import type {
  ScheduledTaskAttachmentRecord,
  ScheduledTaskAttachmentRepository,
  ScheduledTaskAttachmentReplacement,
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
  #scheduledTaskMutation: Promise<void> = Promise.resolve();

  public withScheduledTaskLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#scheduledTaskMutation.then(async () => {
      const deadline = Date.now() + 10_000;
      // 锁只覆盖状态读写和领取；非阻塞退避让 Worker 仍可处理其他业务请求。
      while (!(await this.callScheduledTaskWorker<boolean>("acquireScheduledTaskLock"))) {
        if (Date.now() >= deadline) throw new Error("等待定时任务状态事务超时");
        await delay(25);
      }
      try {
        return await operation();
      } finally {
        await this.callScheduledTaskWorker("releaseScheduledTaskLock");
      }
    });
    this.#scheduledTaskMutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  public listActiveScheduledTaskRunIds(): Promise<readonly string[]> {
    return this.callScheduledTaskWorker("listActiveScheduledTaskRunIds");
  }

  public async claimScheduledTaskRun(runId: string): Promise<void> {
    await this.callScheduledTaskWorker("claimScheduledTaskRun", {
      runId,
    });
  }

  public async releaseScheduledTaskRun(runId: string): Promise<void> {
    await this.callScheduledTaskWorker("releaseScheduledTaskRun", { runId });
  }
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
    attachments?: ScheduledTaskAttachmentReplacement,
  ): Promise<readonly ScheduledTask[]> {
    await this.callScheduledTaskWorker("writeScheduledTasks", {
      attachments,
      tasksJson: serializeScheduledTaskSnapshot(tasks),
    });
    return tasks;
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
}
