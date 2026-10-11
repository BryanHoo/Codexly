import { expect, test, vi } from "vitest";
import { createHarness } from "./app-all.test-support.js";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";
import type { ProjectTodo } from "@codexly/protocol";

test("idle devices receive todo changes after persistence, with no duplicate on replay", async () => {
  const { app } = await createHarness({
    projectTodoRepository: await openRepository(await createWorkspace()),
  });
  await app.ready();
  const messages: unknown[][] = [[], []];
  const sockets = await Promise.all(
    messages.map((frames) =>
      app.injectWS(
        "/v1/workbench/events",
        { headers: { host: "127.0.0.1:3210", origin: "http://127.0.0.1:3210" } },
        {
          onInit(socket) {
            socket.on("message", (data: { toString(): string }) =>
              frames.push(JSON.parse(data.toString())),
            );
          },
        },
      ),
    ),
  );
  try {
    await vi.waitFor(() => {
      expect(messages).toEqual([[{ type: "workbench.ready" }], [{ type: "workbench.ready" }]]);
    });
    const request = {
      method: "POST" as const,
      url: "/v1/projects/codexly/todos",
      headers: { "idempotency-key": "create-push" },
      payload: { content: [{ type: "text", text: "跨设备待办" }], attachments: [] },
    };
    const response = await app.inject(request);
    expect(response.statusCode).toBe(201);
    await vi.waitFor(() => {
      expect(messages.map((frames) => frames.at(-1))).toEqual([
        { type: "project-todos.changed", projectId: "codexly" },
        { type: "project-todos.changed", projectId: "codexly" },
      ]);
    });
    const counts = messages.map((frames) => frames.length);
    expect((await app.inject(request)).json()).toEqual(response.json());
    expect(messages.map((frames) => frames.length)).toEqual(counts);
    const todo = response.json<{ todo: ProjectTodo }>().todo;
    const update = await app.inject({
      method: "PUT",
      url: `${request.url}/${todo.id}`,
      headers: { "idempotency-key": "update-push" },
      payload: { expectedVersion: 1, draft: todo.draft },
    });
    expect(update.statusCode).toBe(200);
    const stale = await app.inject({
      method: "DELETE",
      url: `${request.url}/${todo.id}`,
      headers: { "idempotency-key": "stale-push" },
      payload: { expectedVersion: 1 },
    });
    expect(stale.statusCode).toBe(409);
    await vi.waitFor(() => {
      expect(messages.map((frames) => frames.length)).toEqual([3, 3]);
    });
    const deleted = await app.inject({
      method: "DELETE",
      url: `${request.url}/${todo.id}`,
      headers: { "idempotency-key": "delete-push" },
      payload: { expectedVersion: 2 },
    });
    expect(deleted.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(messages.map((frames) => frames.length)).toEqual([4, 4]);
    });
  } finally {
    sockets.forEach((socket) => {
      socket.terminate();
    });
  }
});
