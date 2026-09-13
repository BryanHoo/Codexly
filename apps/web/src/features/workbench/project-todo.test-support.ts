import { QueryClient } from "@tanstack/react-query";
import { vi } from "vitest";
import type { ProjectTodo, ProjectTodoDraft, SaveProjectTodoRequest } from "@codexly/protocol";
import { createProjectTodoStore } from "./project-todo-store.js";

export function createTodoTestStore() {
  const records = new Map<string, ProjectTodo>();
  const todos = () => ({ data: [...records.values()] });
  const client = {
    createProjectTodo: vi.fn((projectId: string, draft: ProjectTodoDraft) => {
      const todo = { id: "todo-a", projectId, createdAt: 1000, updatedAt: 1000, version: 1, draft };
      records.set(todo.id, todo);
      return Promise.resolve({ todo, todos: todos() });
    }),
    listProjectTodos: vi.fn(() => Promise.resolve(todos())),
    saveProjectTodo: vi.fn((projectId: string, id: string, input: SaveProjectTodoRequest) => {
      const todo = {
        id,
        projectId,
        createdAt: 1000,
        updatedAt: 2000,
        version: input.expectedVersion + 1,
        draft: input.draft,
      };
      records.set(id, todo);
      return Promise.resolve({ todo, todos: todos() });
    }),
    deleteProjectTodo: vi.fn((_projectId: string, id: string) => {
      const deleted = records.delete(id);
      return Promise.resolve({ deleted, todos: todos() });
    }),
  };
  return createProjectTodoStore({ client, queryClient: new QueryClient() });
}
