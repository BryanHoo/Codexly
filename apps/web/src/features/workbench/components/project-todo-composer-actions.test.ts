import { describe, expect, it, vi } from "vitest";

import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import { createProjectTodoStore } from "../project-todo-store.js";
import { createProjectTodoComposerActions } from "./project-todo-composer-actions.js";

function createMemoryStorage(): Pick<Storage, "getItem" | "removeItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function createActions(submitPrompt = vi.fn(() => Promise.resolve(true))) {
  const store = createProjectTodoStore(createMemoryStorage(), {
    createId: () => "todo-a",
    now: () => 1_000,
  });
  store.create("project-a", {
    attachments: [],
    content: [{ text: "已保存内容", type: "text" }],
  });
  store.updateWorking("project-a", "todo-a", {
    attachments: [],
    content: [{ text: "待保存内容", type: "text" }],
  });
  const onEditingComplete = vi.fn();
  const actions = createProjectTodoComposerActions({
    actionLock: createAsyncActionLock(),
    attachments: [],
    clearComposerInput: vi.fn(),
    client: { uploadAttachment: vi.fn() },
    editingTodoId: "todo-a",
    fallbackError: "无法保存待办",
    hasComposerInput: true,
    isCurrentScope: () => true,
    isSubmitting: false,
    onEditingComplete,
    projectId: "project-a",
    projectTodos: store,
    promptContent: [{ text: "待保存内容", type: "text" }],
    routeScope: "project-a:task-a",
    setIsSubmitting: vi.fn(),
    setMutationError: vi.fn(),
    skillEditorRef: { current: null },
    submitPrompt,
  });
  return { actions, onEditingComplete, store };
}

describe("project todo composer actions", () => {
  it("updates a todo only through explicit save", async () => {
    const { actions, store } = createActions();

    await actions.save();

    expect(store.read("project-a", "todo-a")?.draft.content).toEqual([
      { text: "待保存内容", type: "text" },
    ]);
    expect(store.readWorking("project-a", "todo-a")).toBeUndefined();
  });

  it("removes a restored todo only after successful submission", async () => {
    const failed = createActions(vi.fn(() => Promise.resolve(false)));
    await failed.actions.submit({ files: [], text: "发送" });
    expect(failed.store.read("project-a", "todo-a")).toBeDefined();

    const succeeded = createActions();
    await succeeded.actions.submit({ files: [], text: "发送" });
    expect(succeeded.store.read("project-a", "todo-a")).toBeUndefined();
    expect(succeeded.onEditingComplete).toHaveBeenCalledOnce();
  });
});
