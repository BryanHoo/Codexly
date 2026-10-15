import { expect, it, vi } from "vitest";
import { createCodexRuntimeProvider } from "@codexly/provider-codex";
import { createLocalCatalogClient } from "../../provider-codex/src/local-catalog-client.js";
import { createCodexlyServer } from "./app.js";
import { LocalProjectRepository } from "./local-project-repository.js";
import { createServerOptions } from "./app-options.test-support.js";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

it("serves the complete sidebar lifecycle while the execution engine is unavailable", async () => {
  const root = await createWorkspace(),
    store = await openRepository(root);
  await store.catalog("project.put", {
    id: "p",
    name: "项目",
    path: root,
    createdAt: "2026-10-15T00:00:00Z",
  });
  const request = vi.fn(() => Promise.reject(new Error("engine offline")));
  const client = await createLocalCatalogClient(
    {
      request,
      notify: vi.fn(),
      onNotification: vi.fn(() => () => undefined),
      onServerRequest: vi.fn(() => () => undefined),
      rejectServerRequest: vi.fn(),
      respondToServerRequest: vi.fn(),
    },
    store,
  );
  const runtime = createCodexRuntimeProvider({ client });
  const provider = runtime.forProject({
    id: "p",
    name: "项目",
    createdAt: "2026-10-15T00:00:00Z",
    roots: [{ id: "root", path: root }],
  });
  const app = await createCodexlyServer(
    createServerOptions(provider, { projectRepository: new LocalProjectRepository(store, store) }),
  );
  try {
    const created = await app.inject({
      method: "POST",
      url: "/v1/projects/p/tasks",
      payload: {},
      headers: { "idempotency-key": "create" },
    });
    expect(created.statusCode, created.body + JSON.stringify(request.mock.calls)).toBe(201);
    const id = created.json<{ task: { id: string } }>().task.id;
    const rename = await app.inject({
      method: "POST",
      url: `/v1/projects/p/tasks/${id}/rename`,
      payload: { title: "自主管理" },
      headers: { "idempotency-key": "rename" },
    });
    expect(rename.statusCode, rename.body).toBe(200);
    const pin = await app.inject({
      method: "PUT",
      url: `/v1/projects/p/tasks/${id}/pin`,
      payload: { pinned: true },
      headers: { "idempotency-key": "pin" },
    });
    expect(pin.statusCode, pin.body).toBe(200);
    const archived = await app.inject({
      method: "POST",
      url: `/v1/projects/p/tasks/${id}/archive`,
      payload: {},
      headers: { "idempotency-key": "archive" },
    });
    expect(archived.statusCode, archived.body).toBe(200);
    const restored = await app.inject({
      method: "POST",
      url: `/v1/projects/p/tasks/${id}/unarchive`,
      payload: {},
      headers: { "idempotency-key": "restore" },
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json()).toMatchObject({ task: { id, title: "自主管理", pinned: true } });
    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/projects/p/tasks/${id}`,
      payload: {},
      headers: { "idempotency-key": "delete" },
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(await store.catalog("task.read", { id })).toBeNull();
    expect(request).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
