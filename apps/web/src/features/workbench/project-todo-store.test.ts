import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { createProjectTodoStore } from "./project-todo-store.js";

describe("project todo server state", () => {
  const draft = { attachments: [], content: [{ type: "text" as const, text: "正式内容" }] };
  const todo = {
    id: "todo-1",
    projectId: "project-a",
    createdAt: 1,
    updatedAt: 1,
    version: 1,
    draft,
  };
  function setup() {
    const queryClient = new QueryClient();
    const client = {
      createProjectTodo: vi.fn(() => Promise.resolve({ todo })),
      listProjectTodos: vi.fn(() => Promise.resolve({ data: [todo] })),
      saveProjectTodo: vi.fn(() => Promise.resolve({ todo: { ...todo, version: 2 } })),
      deleteProjectTodo: vi.fn(() => Promise.resolve({ deleted: true })),
    };
    return { client, queryClient, store: createProjectTodoStore({ client, queryClient }) };
  }
  it("stores only server-confirmed records and keeps working drafts local", async () => {
    const { store, client } = setup();
    await store.create("project-a", draft);
    store.updateWorking("project-a", "todo-1", {
      attachments: [],
      content: [{ type: "text", text: "未保存" }],
    });
    expect(store.read("project-a", "todo-1")?.draft).toEqual(draft);
    expect(store.readWorking("project-a", "todo-1")?.content[0]).toEqual({
      type: "text",
      text: "未保存",
    });
    expect(client.saveProjectTodo).not.toHaveBeenCalled();
    expect(store.list("other")).toEqual([]);
    await store.save("project-a", "todo-1", draft);
    expect(client.saveProjectTodo).toHaveBeenCalledWith(
      "project-a",
      "todo-1",
      { draft, expectedVersion: 1 },
      expect.any(Object),
    );
    expect(store.readWorking("project-a", "todo-1")).toBeUndefined();
  });
  it("does not remove a todo or its draft when the server rejects deletion", async () => {
    const { store, client } = setup();
    await store.create("project-a", draft);
    client.deleteProjectTodo.mockRejectedValueOnce(new Error("conflict"));
    await expect(store.remove("project-a", "todo-1")).rejects.toThrow("conflict");
    expect(store.read("project-a", "todo-1")).toBeDefined();
  });
  it("shares Query cache updates without replacing a working draft", async () => {
    const { store, queryClient } = setup();
    await store.create("project-a", draft);
    const working = { ...draft, content: [{ type: "text" as const, text: "本地修改" }] };
    store.updateWorking("project-a", "todo-1", working);
    queryClient.setQueryData(["projects", "project-a", "todos"], {
      data: [{ ...todo, version: 2 }],
    });
    expect(store.read("project-a", "todo-1")?.version).toBe(1);
    expect(store.readWorking("project-a", "todo-1")).toEqual(working);
    // 工作副本保留编辑起点版本，保存时交给服务器检测冲突。
  });
});
