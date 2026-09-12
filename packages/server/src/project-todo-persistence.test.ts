import { describe, expect, it } from "vitest";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

describe("project todo persistence", () => {
  const todo = {
    id: "todo-1",
    projectId: "project-a",
    createdAt: 1000,
    updatedAt: 1000,
    version: 1,
    draft: {
      content: [{ type: "text" as const, text: "处理附件" }],
      attachments: [
        {
          id: "attachment-1",
          kind: "text" as const,
          mediaType: "text/plain" as const,
          name: "input.txt",
          size: 3,
        },
      ],
    },
  };
  it("commits todos and attachment content together and restores them after restart", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root);
    await repository.saveProjectTodo(
      todo,
      null,
      todo.draft.attachments.map((attachment) => ({
        attachment,
        content: new Uint8Array([97, 98, 99]),
      })),
    );
    await repository.close();
    const reopened = await openRepository(root);
    expect(await reopened.listProjectTodos("project-a")).toEqual([todo]);
    expect(await reopened.listProjectTodos("other")).toEqual([]);
    expect(
      (await reopened.readProjectTodoAttachment("project-a", "attachment-1"))?.content,
    ).toEqual(new Uint8Array([97, 98, 99]));
    expect(await reopened.readProjectTodoAttachment("other", "attachment-1")).toBeUndefined();
  });
  it("rejects stale edits without replacing saved content or attachments", async () => {
    const repository = await openRepository(await createWorkspace());
    await repository.saveProjectTodo(
      todo,
      null,
      todo.draft.attachments.map((attachment) => ({
        attachment,
        content: new Uint8Array([97, 98, 99]),
      })),
    );
    await expect(
      repository.saveProjectTodo(
        { ...todo, version: 2, draft: { content: [], attachments: [] } },
        99,
        [],
      ),
    ).rejects.toThrow("Project todo changed");
    expect(await repository.listProjectTodos("project-a")).toEqual([todo]);
    expect(await repository.readProjectTodoAttachment("project-a", "attachment-1")).toBeDefined();
    await repository.deleteProjectTodo("project-a", "todo-1", 1);
    expect(await repository.listProjectTodos("project-a")).toEqual([]);
    expect(await repository.readProjectTodoAttachment("project-a", "attachment-1")).toBeUndefined();
  });
});
