import { describe, expect, it } from "vitest";
import { createHarness, multipartAttachment, turnOptions } from "./app-all.test-support.js";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";
import type { AgentMessageAttachment, ProjectTodo } from "@codexly/protocol";

describe("project todo API", () => {
  it("imports a browser todo once without overwriting later server edits", async () => {
    const repository = await openRepository(await createWorkspace());
    const { app } = await createHarness({ projectTodoRepository: repository });
    const draft = { content: [{ type: "text", text: "旧待办" }], attachments: [] };
    const request = {
      method: "POST" as const,
      url: "/v1/projects/codexly/todos/legacy-id/import",
      headers: { "idempotency-key": "import" },
      payload: draft,
    };
    expect((await app.inject(request)).statusCode).toBe(200);
    await app.inject({
      method: "PUT",
      url: "/v1/projects/codexly/todos/legacy-id",
      headers: { "idempotency-key": "edit-import" },
      payload: {
        expectedVersion: 1,
        draft: { ...draft, content: [{ type: "text", text: "新的正式内容" }] },
      },
    });
    const replayed = await app.inject({
      ...request,
      headers: { "idempotency-key": "repeat-import" },
    });
    expect(replayed.json()).toMatchObject({
      todo: { id: "legacy-id", version: 2, draft: { content: [{ text: "新的正式内容" }] } },
    });
    expect(await repository.listProjectTodos("codexly")).toHaveLength(1);
  });
  it("shares saved todos and restores attachments on a new server instance", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root);
    const first = await createHarness({ projectTodoRepository: repository });
    const uploaded = await first.app.inject(
      await multipartAttachment(
        "text",
        "input.txt",
        "text/plain",
        new Uint8Array([97, 98, 99]),
        "upload",
      ),
    );
    const attachment = uploaded.json<{ attachment: AgentMessageAttachment }>().attachment;
    const request = {
      method: "POST" as const,
      url: "/v1/projects/codexly/todos",
      headers: { "idempotency-key": "create-todo" },
      payload: { content: [{ type: "text", text: "处理附件" }], attachments: [attachment] },
    };
    const created = await first.app.inject(request);
    expect(created.statusCode, created.body).toBe(201);
    expect((await first.app.inject(request)).json()).toEqual(created.json());
    const todo = created.json<{ todo: ProjectTodo }>().todo;
    expect(created.json()).toEqual({ todo, todos: { data: [todo] } });
    await first.app.close();
    await repository.close();
    const second = await createHarness({ projectTodoRepository: await openRepository(root) });
    expect((await second.app.inject({ method: "GET", url: request.url })).json()).toEqual({
      data: [todo],
    });
    const preview = await second.app.inject({
      method: "GET",
      url: `/v1/projects/codexly/attachments/${attachment.id}`,
    });
    expect(preview.body).toBe("abc");
    const submitted = await second.app.inject({
      method: "POST",
      url: "/v1/projects/codexly/submissions",
      headers: { "idempotency-key": "run-todo" },
      payload: {
        type: "prompt",
        input: {
          type: "prompt",
          text: "处理附件",
          attachments: [{ id: attachment.id }],
          skills: [],
        },
        options: turnOptions,
      },
    });
    expect(submitted.statusCode, submitted.body).toBe(201);
    expect(second.startTurn).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ textAttachments: [{ name: "input.txt", text: "abc" }] }),
      turnOptions,
    );
  });

  it("rejects stale writes and out-of-scope attachment references", async () => {
    const { app } = await createHarness({
      projectTodoRepository: await openRepository(await createWorkspace()),
    });
    const url = "/v1/projects/codexly/todos";
    const created = await app.inject({
      method: "POST",
      url,
      headers: { "idempotency-key": "create" },
      payload: { content: [{ type: "text", text: "待办" }], attachments: [] },
    });
    expect(created.statusCode).toBe(201);
    const { todo } = created.json<{ todo: ProjectTodo }>();
    const updated = await app.inject({
      method: "PUT",
      url: `${url}/${todo.id}`,
      headers: { "idempotency-key": "update" },
      payload: { draft: todo.draft, expectedVersion: 1 },
    });
    expect(updated.statusCode).toBe(200);
    const stale = await app.inject({
      method: "DELETE",
      url: `${url}/${todo.id}`,
      headers: { "idempotency-key": "delete" },
      payload: { expectedVersion: 1 },
    });
    expect(stale.statusCode).toBe(409);
    const missingAttachment = await app.inject({
      method: "POST",
      url,
      headers: { "idempotency-key": "bad-attachment" },
      payload: {
        content: [],
        attachments: [
          {
            id: "other-project-attachment",
            kind: "text",
            name: "x.txt",
            mediaType: "text/plain",
            size: 3,
          },
        ],
      },
    });
    expect(missingAttachment.statusCode).toBe(404);
  });
});
