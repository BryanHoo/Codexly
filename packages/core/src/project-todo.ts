import type { AgentMessageAttachment, ProjectTodo, ProjectTodoDraft } from "@codexly/protocol";

export type ProjectTodoAttachment = Readonly<{
  attachment: AgentMessageAttachment;
  content: Uint8Array;
}>;
export interface ProjectTodoRepository {
  listProjectTodos(projectId: string): Promise<readonly ProjectTodo[]>;
  saveProjectTodo(
    todo: ProjectTodo,
    expectedVersion: number | null,
    attachments: readonly ProjectTodoAttachment[],
  ): Promise<void>;
  deleteProjectTodo(projectId: string, todoId: string, expectedVersion: number): Promise<boolean>;
  readProjectTodoAttachment(
    projectId: string,
    attachmentId: string,
  ): Promise<ProjectTodoAttachment | undefined>;
}

export class ProjectTodoError extends Error {
  constructor(
    public readonly code: "PROJECT_TODO_CHANGED" | "PROJECT_TODO_NOT_FOUND",
    message: string,
  ) {
    super(message);
  }
}

export async function saveProjectTodo(
  repository: ProjectTodoRepository,
  projectId: string,
  id: string,
  draft: ProjectTodoDraft,
  expectedVersion: number | null,
  now: number,
  prepareAttachments: () => Promise<readonly ProjectTodoAttachment[]>,
): Promise<ProjectTodo> {
  const existing = (await repository.listProjectTodos(projectId)).find((todo) => todo.id === id);
  if (expectedVersion !== null && existing === undefined)
    throw new ProjectTodoError("PROJECT_TODO_NOT_FOUND", "Project todo not found");
  if ((existing?.version ?? null) !== expectedVersion)
    throw new ProjectTodoError("PROJECT_TODO_CHANGED", "Project todo changed");
  const todo: ProjectTodo = {
    id,
    projectId,
    draft,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    version: (existing?.version ?? 0) + 1,
  };
  const attachments = await prepareAttachments();
  // 资源准备不写库；Repository 在一个事务中校验版本并提交正文和二进制。
  await repository.saveProjectTodo(todo, expectedVersion, attachments);
  return todo;
}
