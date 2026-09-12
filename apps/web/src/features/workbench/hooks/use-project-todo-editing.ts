import { useEffect, useState } from "react";

import {
  useProjectTodos,
  useProjectTodoStore,
  useProjectTodoQuery,
} from "../project-todo-context.js";
import { notifyActionError } from "../../notifications/action-notifications.js";

export function useProjectTodoEditing(projectId: string, initialTodoId?: string) {
  const projectTodos = useProjectTodoStore();
  const query = useProjectTodoQuery(projectId);
  const todos = useProjectTodos(projectId);
  const [editingTodo, setEditingTodo] = useState<
    Readonly<{ projectId: string; todoId: string }> | undefined
  >(
    initialTodoId !== undefined && projectTodos.read(projectId, initialTodoId) !== undefined
      ? { projectId, todoId: initialTodoId }
      : undefined,
  );
  const editingTodoId = editingTodo?.projectId === projectId ? editingTodo.todoId : undefined;

  useEffect(() => {
    setEditingTodo(
      initialTodoId !== undefined && projectTodos.read(projectId, initialTodoId) !== undefined
        ? { projectId, todoId: initialTodoId }
        : undefined,
    );
  }, [initialTodoId, projectId, projectTodos, query.isSuccess]);

  const complete = () => {
    setEditingTodo(undefined);
  };
  const remove = async (todoId: string) => {
    try {
      await projectTodos.remove(projectId, todoId);
      if (editingTodoId === todoId) complete();
    } catch (error) {
      notifyActionError(error instanceof Error ? error : new Error(String(error)));
    }
  };
  const restore = (todoId: string, clearCurrent: () => void) => {
    if (projectTodos.read(projectId, todoId) === undefined) return;
    if (editingTodoId === undefined) clearCurrent();
    setEditingTodo({ projectId, todoId });
  };
  const discardIfEmpty = (hasInput: boolean) => {
    if (editingTodoId === undefined || hasInput) return;
    projectTodos.discardWorking(projectId, editingTodoId);
    complete();
  };

  return {
    complete,
    discardIfEmpty,
    editingTodoId,
    projectTodos,
    remove,
    restore,
    todos,
    query,
  } as const;
}
