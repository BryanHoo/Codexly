import {
  ProjectTodoPageSchema,
  ProjectTodoResponseSchema,
  DeleteProjectTodoResponseSchema,
  type ProjectTodoDraft,
  type SaveProjectTodoRequest,
} from "@codexly/protocol";
import { PersonalizationHttpClient } from "./http-client-personalization.js";
import { projectPath, type MutationOptions, type ReadOptions } from "./http-client-transport.js";

export class ProjectTodoHttpClient extends PersonalizationHttpClient {
  // 浏览器历史记录属于不可信输入，由后端统一按当前协议校验。
  importProjectTodo(
    projectId: string,
    todoId: string,
    draft: unknown,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      `${projectPath(projectId)}/todos/${encodeURIComponent(todoId)}/import`,
      draft,
      ProjectTodoResponseSchema,
      options,
    );
  }
  listProjectTodos(projectId: string, options: ReadOptions = {}) {
    return this.read(`${projectPath(projectId)}/todos`, ProjectTodoPageSchema, options);
  }
  createProjectTodo(projectId: string, draft: ProjectTodoDraft, options: MutationOptions = {}) {
    return this.mutation(
      `${projectPath(projectId)}/todos`,
      draft,
      ProjectTodoResponseSchema,
      options,
    );
  }
  saveProjectTodo(
    projectId: string,
    todoId: string,
    input: SaveProjectTodoRequest,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      `${projectPath(projectId)}/todos/${encodeURIComponent(todoId)}`,
      input,
      ProjectTodoResponseSchema,
      options,
      "PUT",
    );
  }
  deleteProjectTodo(
    projectId: string,
    todoId: string,
    expectedVersion: number,
    options: MutationOptions = {},
  ) {
    return this.mutation(
      `${projectPath(projectId)}/todos/${encodeURIComponent(todoId)}`,
      { expectedVersion },
      DeleteProjectTodoResponseSchema,
      options,
      "DELETE",
    );
  }
}
