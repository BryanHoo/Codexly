import { randomUUID } from "node:crypto";
import { saveProjectTodo, ProjectTodoError, type ProjectTodoRepository } from "@codexly/core";
import type { ProjectTodoDraft } from "@codexly/protocol";
import { AttachmentNotFoundError } from "./attachment-store.js";
import { MutationHttpError, type ServerRouteContext } from "./routes/context.js";

export function requireProjectTodoRepository(context: ServerRouteContext): ProjectTodoRepository {
  if (context.projectTodoRepository === undefined)
    throw new MutationHttpError("PROVIDER_ERROR", "Project todo persistence is unavailable", 503);
  return context.projectTodoRepository;
}

export async function importProjectTodo(
  context: ServerRouteContext,
  projectId: string,
  todoId: string,
  draft: ProjectTodoDraft,
) {
  // 原始身份作为迁移去重边界，绝不覆盖导入后的服务器编辑。
  const existing = (await requireProjectTodoRepository(context).listProjectTodos(projectId)).find(
    (item) => item.id === todoId,
  );
  return existing ?? (await writeProjectTodo(context, projectId, draft, todoId));
}

export async function writeProjectTodo(
  context: ServerRouteContext,
  projectId: string,
  draft: ProjectTodoDraft,
  id: string = randomUUID(),
  expectedVersion: number | null = null,
) {
  const repository = requireProjectTodoRepository(context);
  return saveProjectTodo(
    repository,
    projectId,
    id,
    draft,
    expectedVersion,
    Date.now(),
    async () => {
      const attachments = [];
      // 顺序读取控制二进制峰值；当前存储缺失时只允许从同项目持久附件恢复。
      for (const attachment of draft.attachments) {
        let stored;
        try {
          stored = await context.attachmentStore.read(projectId, attachment.id);
        } catch (error) {
          if (!(error instanceof AttachmentNotFoundError)) throw error;
          stored = await repository.readProjectTodoAttachment(projectId, attachment.id);
        }
        if (stored === undefined)
          throw new MutationHttpError(
            "ATTACHMENT_NOT_FOUND",
            "Project todo attachment not found",
            404,
          );
        if (
          stored.attachment.kind !== attachment.kind ||
          stored.attachment.name !== attachment.name ||
          stored.attachment.mediaType !== attachment.mediaType ||
          stored.attachment.size !== attachment.size
        )
          throw new MutationHttpError(
            "INVALID_REQUEST",
            "Project todo attachment metadata does not match",
            400,
          );
        attachments.push({ attachment, content: stored.content });
      }
      return attachments;
    },
  );
}

export function toProjectTodoHttpError(error: unknown): never {
  if (error instanceof ProjectTodoError)
    throw new MutationHttpError(
      error.code,
      error.message,
      error.code === "PROJECT_TODO_NOT_FOUND" ? 404 : 409,
    );
  throw error;
}
