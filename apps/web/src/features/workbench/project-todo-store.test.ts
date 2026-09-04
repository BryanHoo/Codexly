import { describe, expect, it } from "vitest";

import { createProjectTodoStore } from "./project-todo-store.js";

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

describe("project todo store", () => {
  it("isolates todos by project and saves working changes explicitly", () => {
    const storage = createMemoryStorage();
    const store = createProjectTodoStore(storage, {
      createId: () => "todo-a",
      now: () => 1_000,
    });
    const original = {
      attachments: [],
      content: [{ text: "原始内容", type: "text" as const }],
    };
    store.create("project-a", original);
    store.updateWorking("project-a", "todo-a", {
      attachments: [],
      content: [{ text: "未保存修改", type: "text" }],
    });

    expect(store.list("project-b")).toEqual([]);
    expect(store.read("project-a", "todo-a")?.draft).toEqual(original);
    expect(store.readWorking("project-a", "todo-a")?.content).toEqual([
      { text: "未保存修改", type: "text" },
    ]);

    const workingDraft = store.readWorking("project-a", "todo-a");
    expect(workingDraft).toBeDefined();
    if (workingDraft === undefined) throw new Error("Expected a working todo draft");
    store.save("project-a", "todo-a", workingDraft);

    expect(store.read("project-a", "todo-a")?.draft.content).toEqual([
      { text: "未保存修改", type: "text" },
    ]);
    expect(store.readWorking("project-a", "todo-a")).toBeUndefined();
  });

  it("restores persisted todos in newest-first order", () => {
    const storage = createMemoryStorage();
    let now = 1_000;
    let sequence = 0;
    const store = createProjectTodoStore(storage, {
      createId: () => `todo-${String(++sequence)}`,
      now: () => now,
    });

    store.create("project-a", { attachments: [], content: [{ text: "第一条", type: "text" }] });
    now = 2_000;
    store.create("project-a", { attachments: [], content: [{ text: "第二条", type: "text" }] });

    const reloaded = createProjectTodoStore(storage);
    expect(reloaded.list("project-a").map((todo) => todo.id)).toEqual(["todo-2", "todo-1"]);
  });
});
