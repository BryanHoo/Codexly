import { expect, it, vi } from "vitest";
import { createLocalCatalogClient } from "../../provider-codex/src/local-catalog-client.js";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

it("keeps metadata local and maps execution IDs in both directions", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  await store.catalog("project.put", {
    id: "p",
    name: "项目",
    path: root,
    createdAt: "2026-10-15T00:00:00Z",
  });
  await store.catalog("migration.import", { projects: [], tasks: [] });
  const request = vi.fn((method: string, params?: unknown) =>
    Promise.resolve(
      (() => {
        if (method === "thread/start")
          return {
            thread: {
              id: "native",
              cwd: root,
              projectId: null,
              name: null,
              preview: "",
              updatedAt: 100,
              status: { type: "idle" },
              section: null,
            },
          };
        if (method === "thread/settings/update") return {};
        if (method === "turn/start") return { turn: { id: "turn", items: [] }, params };
        throw new Error(`Unexpected upstream management: ${method}`);
      })(),
    ),
  );
  const raw = {
    request,
    notify: vi.fn(),
    onNotification: vi.fn(() => () => undefined),
    onServerRequest: vi.fn(() => () => undefined),
    rejectServerRequest: vi.fn(),
    respondToServerRequest: vi.fn(),
  };
  const client = await createLocalCatalogClient(raw, store);
  const created = (await client.request("thread/start", { projectId: "p", cwd: root })) as {
    thread: { id: string };
  };
  expect(created.thread.id).not.toBe("native");
  await client.request("thread/name/set", { threadId: created.thread.id, name: "本地名称" });
  await client.request("thread/section/move", { threadId: created.thread.id, sectionId: "pinned" });
  await client.request("thread/archive", { threadId: created.thread.id });
  expect(await client.request("thread/list", { projectId: "p", archived: true })).toMatchObject({
    data: [{ id: created.thread.id, name: "本地名称" }],
  });
  expect(request).not.toHaveBeenCalled();
  await client.request("turn/start", { threadId: created.thread.id, input: [] });
  expect(request).toHaveBeenLastCalledWith(
    "turn/start",
    { threadId: "native", input: [] },
    undefined,
    undefined,
  );
});

it("persists workspace changes after binding a native execution session", async () => {
  const root = await createWorkspace(),
    store = await openRepository(root);
  await store.catalog("task.put", {
    id: "task-local",
    projectId: null,
    title: "分叉",
    cwd: root,
    provider: "codex",
    sessionId: "native",
    updatedAt: 100,
    pinned: false,
    archived: false,
    status: "idle",
  });
  const request = vi.fn(() => Promise.resolve({}));
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
  await client.request("thread/settings/update", { threadId: "task-local", cwd: "/new-worktree" });
  expect(await store.catalog("task.read", { id: "task-local" })).toMatchObject({
    cwd: "/new-worktree",
  });
});
