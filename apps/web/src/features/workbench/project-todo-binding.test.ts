import { describe, expect, it } from "vitest";

import { createComposerDraftStore } from "./composer-draft-context.js";
import { createProjectTodoBinding, shouldRestoreComposerBinding } from "./project-todo-binding.js";
import { createProjectTodoStore } from "./project-todo-store.js";

function createMemoryStorage(): Pick<Storage, "getItem" | "removeItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("composer project todo binding", () => {
  it("restores when only the storage scope changes", () => {
    expect(
      shouldRestoreComposerBinding(
        { routeScope: "project-a:task-a", storageScope: "task-a" },
        { routeScope: "project-a:task-a", storageScope: "todo-a" },
      ),
    ).toBe(true);
  });

  it("keeps a todo working copy stable across task route changes", () => {
    const storage = createMemoryStorage();
    const composerDrafts = createComposerDraftStore(storage);
    const projectTodos = createProjectTodoStore(storage, { createId: () => "todo-a" });
    projectTodos.create("project-a", {
      attachments: [],
      content: [{ text: "保存版本", type: "text" }],
    });
    const taskA = createProjectTodoBinding({
      composerDrafts,
      editingTodoId: "todo-a",
      projectId: "project-a",
      projectTodos,
      taskId: "task-a",
    });
    const taskB = createProjectTodoBinding({
      composerDrafts,
      editingTodoId: "todo-a",
      projectId: "project-a",
      projectTodos,
      taskId: "task-b",
    });

    taskA.update(() => ({
      attachments: [],
      content: [{ text: "未保存工作副本", type: "text" }],
    }));

    expect(taskA.scope).toBe(taskB.scope);
    expect(taskB.read().content).toEqual([{ text: "未保存工作副本", type: "text" }]);
  });

  it("keeps ordinary composer drafts task-scoped", () => {
    const storage = createMemoryStorage();
    const composerDrafts = createComposerDraftStore(storage);
    const projectTodos = createProjectTodoStore(storage);
    const taskA = createProjectTodoBinding({
      composerDrafts,
      editingTodoId: undefined,
      projectId: "project-a",
      projectTodos,
      taskId: "task-a",
    });
    const taskB = createProjectTodoBinding({
      composerDrafts,
      editingTodoId: undefined,
      projectId: "project-a",
      projectTodos,
      taskId: "task-b",
    });

    taskA.update(() => ({ attachments: [], content: [{ text: "任务 A", type: "text" }] }));

    expect(taskA.scope).not.toBe(taskB.scope);
    expect(taskB.read()).toEqual({ attachments: [], content: [] });
  });
});
