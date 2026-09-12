import type { TaskSubmissionRecord, TaskSubmissionRepository } from "@codexly/core";
import { AgentTaskSchema, SubmitTaskResponseSchema } from "@codexly/protocol";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { SqliteScheduledTaskRepository } from "./scheduled-task-repository-helpers.js";

const RecordSchema = Type.Object(
  {
    fingerprint: Type.String({ minLength: 1 }),
    stage: Type.Union(
      ["ready", "creating", "starting", "started", "completed"].map((stage) => Type.Literal(stage)),
    ),
    task: Type.Optional(AgentTaskSchema),
    result: Type.Optional(SubmitTaskResponseSchema),
    attachmentIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  },
  { additionalProperties: false },
);

export abstract class SqliteSubmissionRepository
  extends SqliteScheduledTaskRepository
  implements TaskSubmissionRepository
{
  public async readSubmission(
    projectId: string,
    key: string,
  ): Promise<TaskSubmissionRecord | undefined> {
    const json = await this.callScheduledTaskWorker<string | undefined>("readSubmission", {
      projectId,
      key,
    });
    if (json === undefined) return undefined;
    const value: unknown = JSON.parse(json);
    if (!Value.Check(RecordSchema, value)) throw new Error("Persisted submission is invalid");
    return value as TaskSubmissionRecord;
  }

  public async writeSubmission(
    projectId: string,
    key: string,
    record: TaskSubmissionRecord,
  ): Promise<void> {
    if (!Value.Check(RecordSchema, record)) throw new Error("Submission record is invalid");
    await this.callScheduledTaskWorker("writeSubmission", {
      projectId,
      key,
      recordJson: JSON.stringify(record),
      completed: record.stage === "completed",
    });
  }
}
