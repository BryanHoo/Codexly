import {
  TaskActivityPageSchema,
  ProjectTodoPageSchema,
  ProjectTodoResponseSchema,
  DeleteProjectTodoResponseSchema,
  WorkbenchChangeSchema,
  type WorkbenchChange,
  type ProjectTodoDraft,
  type SaveProjectTodoRequest,
} from "@codexly/protocol";
import { Type } from "@sinclair/typebox";
import { PersonalizationHttpClient } from "./http-client-personalization.js";
import { projectPath, type MutationOptions, type ReadOptions } from "./http-client-transport.js";
import { subscribeResourceChanges } from "./resource-change-events.js";

export class ProjectTodoHttpClient extends PersonalizationHttpClient {
  getTaskActivities(options: ReadOptions = {}) {
    return this.read("/v1/tasks/activity", TaskActivityPageSchema, options);
  }
  acknowledgeTaskActivity(projectId: string, taskId: string, version: number) {
    return this.mutation(
      "/v1/tasks/activity/acknowledge",
      { projectId, taskId, version },
      Type.Object({ acknowledged: Type.Boolean() }),
      {},
    );
  }
  readonly #workbenchListeners = new Set<(change: WorkbenchChange) => void>();
  #stopWorkbench: (() => void) | undefined;
  subscribeWorkbenchChanges(onChange: (change: WorkbenchChange) => void): () => void {
    const shared = this.#stopWorkbench !== undefined;
    this.#workbenchListeners.add(onChange);
    if (shared)
      queueMicrotask(() => {
        if (this.#workbenchListeners.has(onChange)) onChange({ type: "workbench.ready" });
      });
    this.#stopWorkbench ??= subscribeResourceChanges(
      this.baseUrl,
      this.webSocketFactory,
      "/v1/workbench/events",
      WorkbenchChangeSchema,
      (change) => {
        for (const listener of this.#workbenchListeners) listener(change);
      },
    );
    return () => {
      this.#workbenchListeners.delete(onChange);
      if (this.#workbenchListeners.size === 0) {
        this.#stopWorkbench?.();
        this.#stopWorkbench = undefined;
      }
    };
  }
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
