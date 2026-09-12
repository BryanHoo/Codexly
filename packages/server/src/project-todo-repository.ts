import {
  ProjectTodoError,
  type ProjectTodoRepository,
  type ProjectTodoAttachment,
} from "@codexly/core";
import {
  ProjectTodoSchema,
  AgentMessageAttachmentSchema,
  type ProjectTodo,
} from "@codexly/protocol";
import { Value } from "@sinclair/typebox/value";
import { SqliteSubmissionRepository } from "./submission-repository.js";

export abstract class SqliteProjectTodoRepository
  extends SqliteSubmissionRepository
  implements ProjectTodoRepository
{
  public async listProjectTodos(projectId: string): Promise<readonly ProjectTodo[]> {
    const rows = await this.callScheduledTaskWorker<string[]>("listProjectTodos", { projectId });
    return rows.map((json) => {
      const value: unknown = JSON.parse(json);
      if (!Value.Check(ProjectTodoSchema, value))
        throw new Error("Persisted project todo is invalid");
      return value;
    });
  }
  public async saveProjectTodo(
    todo: ProjectTodo,
    expectedVersion: number | null,
    attachments: readonly ProjectTodoAttachment[],
  ): Promise<void> {
    if (!Value.Check(ProjectTodoSchema, todo)) throw new Error("Project todo is invalid");
    const metadata = new Map(todo.draft.attachments.map((item) => [item.id, item]));
    const mismatched = attachments.some(({ attachment, content }) => {
      const expected = metadata.get(attachment.id);
      return (
        expected === undefined ||
        expected.kind !== attachment.kind ||
        expected.name !== attachment.name ||
        expected.mediaType !== attachment.mediaType ||
        expected.size !== attachment.size ||
        content.byteLength !== attachment.size
      );
    });
    if (
      metadata.size !== todo.draft.attachments.length ||
      attachments.length !== metadata.size ||
      new Set(attachments.map((item) => item.attachment.id)).size !== metadata.size ||
      mismatched
    )
      throw new Error("Project todo attachments are invalid");
    const saved = await this.callScheduledTaskWorker<boolean>("saveProjectTodo", {
      todo,
      expectedVersion,
      attachments,
    });
    if (!saved) throw new ProjectTodoError("PROJECT_TODO_CHANGED", "Project todo changed");
  }
  public async deleteProjectTodo(
    projectId: string,
    todoId: string,
    expectedVersion: number,
  ): Promise<boolean> {
    const result = await this.callScheduledTaskWorker<boolean | null>("deleteProjectTodo", {
      projectId,
      todoId,
      expectedVersion,
    });
    if (result === null) throw new ProjectTodoError("PROJECT_TODO_CHANGED", "Project todo changed");
    return result;
  }
  public async readProjectTodoAttachment(
    projectId: string,
    attachmentId: string,
  ): Promise<ProjectTodoAttachment | undefined> {
    const row = await this.callScheduledTaskWorker<
      { metadata: string; content: Uint8Array } | undefined
    >("readProjectTodoAttachment", { projectId, attachmentId });
    if (row === undefined) return undefined;
    const attachment: unknown = JSON.parse(row.metadata);
    if (
      !Value.Check(AgentMessageAttachmentSchema, attachment) ||
      !(row.content instanceof Uint8Array) ||
      row.content.byteLength !== attachment.size
    )
      throw new Error("Persisted project todo attachment is invalid");
    return { attachment, content: row.content };
  }
}
