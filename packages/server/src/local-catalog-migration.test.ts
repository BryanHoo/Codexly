import { mkdir, realpath } from "node:fs/promises";
import { join, win32 } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { ProjectPageSchema } from "@codexly/protocol";
import { LocalProjectRepository } from "./local-project-repository.js";
import { expect, it, vi } from "vitest";
import { importCodexCatalog } from "../../provider-codex/src/local-catalog-migration.js";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

it("splits legacy folders, preserves archived tasks and imports only once", async () => {
  const root = await createWorkspace(),
    first = join(root, "one"),
    second = join(root, "two");
  await Promise.all([mkdir(first), mkdir(second)]);
  const store = await openRepository(root);
  const request = vi.fn((method: string, params?: unknown) =>
    Promise.resolve(
      (() => {
        if (method === "project/list")
          return {
            data: [
              {
                id: "legacy",
                name: "旧项目",
                createdAt: 100,
                roots: [{ path: first }, { path: second }],
              },
            ],
            nextCursor: null,
          };
        if (method === "thread/list") {
          const archived = (params as { archived: boolean }).archived;
          return {
            data: [
              {
                id: archived ? "old-archived" : "old-active",
                projectId: "legacy",
                cwd: archived ? second : first,
                name: "历史任务",
                updatedAt: 100,
                section: null,
              },
            ],
            nextCursor: null,
          };
        }
        throw new Error("Migration must not mutate upstream");
      })(),
    ),
  );
  const client = {
    request,
    notify: vi.fn(),
    onNotification: vi.fn(() => () => undefined),
    onServerRequest: vi.fn(() => () => undefined),
    rejectServerRequest: vi.fn(),
    respondToServerRequest: vi.fn(),
  };
  await importCodexCatalog(client, store, []);
  const projects = await store.catalog("project.list", undefined);
  expect(projects).toHaveLength(2);
  expect(projects.map((project) => project.path)).toEqual([
    await realpath(first),
    await realpath(second),
  ]);
  expect(
    Value.Check(ProjectPageSchema, {
      data: await new LocalProjectRepository(store, store).list(),
      nextCursor: null,
    }),
  ).toBe(true);
  expect(projects[0]?.id).toBe("legacy");
  expect(await store.catalog("task.read", { id: "old-archived" })).toMatchObject({
    projectId: projects[1]?.id,
    sessionId: "old-archived",
    archived: true,
  });
  await store.catalog("task.patch", { id: "old-active", title: "已在本地重命名" });
  request.mockClear();
  await importCodexCatalog(client, store, []);
  expect(request).not.toHaveBeenCalled();
  expect(await store.catalog("task.read", { id: "old-active" })).toMatchObject({
    title: "已在本地重命名",
  });
});

it.skipIf(process.platform === "win32")(
  "repairs already imported comparison keys without overwriting local metadata",
  async () => {
    const root = await createWorkspace();
    const path = join(root, "MixedCaseProject");
    await mkdir(path);
    const canonical = await realpath(path);
    const store = await openRepository(root);
    await store.catalog("migration.import", {
      projects: [
        {
          id: "legacy",
          name: "本地名称",
          path: win32.resolve(canonical).toLowerCase(),
          createdAt: "2026-10-15T00:00:00Z",
        },
      ],
      tasks: [
        {
          id: "kept",
          projectId: "legacy",
          title: "本地任务",
          cwd: path,
          provider: "codex",
          sessionId: "native",
          updatedAt: 100,
          pinned: true,
          archived: true,
          status: "idle",
        },
      ],
    });
    const request = vi.fn((method: string) => {
      if (method !== "project/list") throw new Error("Repair must not reread or overwrite tasks");
      return Promise.resolve({
        data: [{ id: "legacy", name: "上游旧名称", createdAt: 100, roots: [{ path }] }],
        nextCursor: null,
      });
    });
    const client = {
      request,
      notify: vi.fn(),
      onNotification: vi.fn(() => () => undefined),
      onServerRequest: vi.fn(() => () => undefined),
      rejectServerRequest: vi.fn(),
      respondToServerRequest: vi.fn(),
    };
    await importCodexCatalog(client, store, []);
    expect(await store.catalog("project.read", { id: "legacy" })).toMatchObject({
      path: canonical,
      name: "本地名称",
    });
    expect((await store.list())[0]?.roots[0]?.path).toBe(canonical);
    expect(await store.catalog("task.read", { id: "kept" })).toMatchObject({
      title: "本地任务",
      pinned: true,
      archived: true,
      sessionId: "native",
    });
    request.mockClear();
    await importCodexCatalog(client, store, []);
    expect(request).not.toHaveBeenCalled();
  },
);

it("rolls back incomplete imports, leaving a retryable migration", async () => {
  const store = await openRepository(await createWorkspace());
  await expect(
    store.catalog("migration.import", {
      projects: [{ id: "p", path: "/work", name: "项目", createdAt: "2026-10-15T00:00:00Z" }],
      tasks: [
        {
          id: "t",
          projectId: "missing",
          cwd: "/work",
          title: "任务",
          provider: "codex",
          sessionId: "native",
          updatedAt: 100,
          pinned: false,
          archived: false,
          status: "idle",
        },
      ],
    }),
  ).rejects.toThrow();
  expect(await store.catalog("migration.done", undefined)).toBe(false);
  expect(await store.catalog("project.list", undefined)).toEqual([]);
});
