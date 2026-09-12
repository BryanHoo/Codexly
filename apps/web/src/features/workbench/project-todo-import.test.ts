import { describe, expect, it, vi } from "vitest";
import { createLegacyTodoImporter } from "./project-todo-import.js";

describe("browser todo migration", () => {
  function setup() {
    const key = "codexly:project-todo:v1:project-a:todo-a";
    const records = new Map([
      ["codexly:project-todos:v1:project-a", JSON.stringify({ todos: [{ id: "todo-a" }] })],
      [
        key,
        JSON.stringify({
          draft: { content: [{ type: "text", text: "旧内容" }], attachments: [] },
          workingDraft: { content: [{ type: "text", text: "最新编辑" }], attachments: [] },
        }),
      ],
    ]);
    const storage = {
      getItem: (id: string) => records.get(id) ?? null,
      setItem: (id: string, value: string) => {
        records.set(id, value);
      },
    };
    const client = { importProjectTodo: vi.fn().mockResolvedValue({}) };
    const onError = vi.fn();
    return {
      key,
      records,
      storage,
      client,
      onError,
      migrate: createLegacyTodoImporter(client, storage, onError),
    };
  }
  it("imports the latest content once while preserving the original backup", async () => {
    const { key, records, migrate, client } = setup();
    const original = records.get(key);
    await Promise.all([migrate("project-a"), migrate("project-a")]);
    expect(client.importProjectTodo).toHaveBeenCalledExactlyOnceWith(
      "project-a",
      "todo-a",
      { content: [{ type: "text", text: "最新编辑" }], attachments: [] },
      { idempotencyKey: "import:todo-a" },
    );
    expect(records.get(key)).toBe(original);
    expect(records.get(`${key}:imported`)).toBe("1");
  });
  it("keeps failed imports retryable after reload and reports missing attachments", async () => {
    const { key, records, migrate, client, storage, onError } = setup();
    client.importProjectTodo.mockRejectedValueOnce(new Error("Attachment expired"));
    await migrate("project-a");
    expect(records.has(`${key}:imported`)).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
    await createLegacyTodoImporter(client, storage, onError)("project-a");
    expect(client.importProjectTodo).toHaveBeenCalledTimes(2);
  });
});
