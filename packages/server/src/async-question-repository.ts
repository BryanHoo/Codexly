import type { AsyncQuestionRecord, AsyncQuestionRepository } from "@codexly/core";
import {
  AsyncQuestionGroupSchema,
  AnswerAsyncQuestionResultSchema,
  type AsyncQuestionGroup,
} from "@codexly/protocol";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { SqliteProjectTodoRepository } from "./project-todo-repository.js";

const RecordSchema = Type.Object(
  {
    group: AsyncQuestionGroupSchema,
    fingerprint: Type.Optional(Type.String()),
    result: Type.Optional(AnswerAsyncQuestionResultSchema),
  },
  { additionalProperties: false },
);
export abstract class SqliteAsyncQuestionRepository
  extends SqliteProjectTodoRepository
  implements AsyncQuestionRepository
{
  public async listAsyncQuestions(
    projectId: string,
    taskId: string,
  ): Promise<readonly AsyncQuestionRecord[]> {
    const rows = await this.callScheduledTaskWorker<string[]>("listAsyncQuestions", {
      projectId,
      taskId,
    });
    return rows.map((json) => {
      const value: unknown = JSON.parse(json);
      if (!Value.Check(RecordSchema, value)) throw new Error("Persisted async question is invalid");
      return value;
    });
  }
  public async discoverAsyncQuestions(
    projectId: string,
    taskId: string,
    groups: readonly AsyncQuestionGroup[],
  ): Promise<void> {
    if (
      groups.some(
        (group) => !Value.Check(AsyncQuestionGroupSchema, group) || group.status !== "pending",
      )
    )
      throw new Error("Async question is invalid");
    await this.callScheduledTaskWorker("discoverAsyncQuestions", { projectId, taskId, groups });
  }
  public updateAsyncQuestion(
    projectId: string,
    taskId: string,
    record: AsyncQuestionRecord,
    expectedStatus: AsyncQuestionGroup["status"],
  ): Promise<boolean> {
    if (!Value.Check(RecordSchema, record)) throw new Error("Async question record is invalid");
    return this.callScheduledTaskWorker<boolean>("updateAsyncQuestion", {
      projectId,
      taskId,
      record,
      expectedStatus,
    });
  }
  public async dismissAsyncQuestions(
    projectId: string,
    taskId: string,
    ids: readonly string[],
  ): Promise<void> {
    await this.callScheduledTaskWorker("dismissAsyncQuestions", { projectId, taskId, ids });
  }
}
