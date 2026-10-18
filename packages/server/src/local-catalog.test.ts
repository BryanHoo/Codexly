import { describe, expect, it } from "vitest";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

describe("application-owned catalog", () => {
  it("filters selected search engines before pagination", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root);
    for (const [id, provider, updatedAt] of [
      ["new", "codex", 3],
      ["match", "claude", 2],
      ["older", "claude", 1],
    ] as const) {
      await repository.catalog("task.put", {
        id,
        provider,
        updatedAt,
        projectId: null,
        title: "搜索",
        cwd: root,
        sessionId: null,
        pinned: false,
        archived: false,
        status: "idle",
      });
    }
    const page = await repository.catalog("task.list", { providers: ["claude"], limit: 1 });
    expect(page.data.map((task) => task.id)).toEqual(["match"]);
    expect(
      (
        await repository.catalog("task.list", {
          providers: ["claude"],
          limit: 1,
          cursor: page.nextCursor,
        })
      ).data.map((task) => task.id),
    ).toEqual(["older"]);
  });
  it("persists independent project/task identities and local lifecycle without a provider", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root);
    const project = {
      id: "local-project",
      name: "项目",
      path: root,
      createdAt: "2026-10-15T00:00:00Z",
    };
    await repository.catalog("project.put", project);
    await repository.catalog("task.put", {
      id: "local-task",
      projectId: project.id,
      title: "任务",
      cwd: root,
      provider: "codex",
      sessionId: "native-session",
      updatedAt: 100,
      pinned: false,
      archived: false,
      status: "idle",
    });
    await repository.catalog("task.patch", {
      id: "local-task",
      title: "本地名称",
      pinned: true,
      archived: true,
    });
    await repository.close();
    const reopened = await openRepository(root);
    expect(await reopened.catalog("task.list", { projectId: project.id })).toMatchObject({
      data: [],
    });
    expect(
      await reopened.catalog("task.list", { projectId: project.id, archived: true }),
    ).toMatchObject({
      data: [{ id: "local-task", sessionId: "native-session", title: "本地名称", pinned: true }],
      nextCursor: null,
    });
    expect(
      await reopened.catalog("task.list", { projectId: "other", archived: true }),
    ).toMatchObject({ data: [] });
  });

  it("deduplicates folders and pages after filtering with deterministic tie breaks", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root);
    await repository.catalog("project.put", {
      id: "p",
      name: "项目",
      path: root,
      createdAt: "2026-10-15T00:00:00Z",
    });
    await expect(
      repository.catalog("project.put", {
        id: "other",
        name: "重复",
        path: root,
        createdAt: "2026-10-15T00:00:00Z",
      }),
    ).rejects.toThrow();
    for (const id of ["a", "b", "c"])
      await repository.catalog("task.put", {
        id,
        projectId: "p",
        title: id,
        cwd: root,
        provider: "codex",
        sessionId: `native-${id}`,
        updatedAt: 100,
        pinned: id !== "b",
        archived: false,
        status: "idle",
      });
    const first = await repository.catalog("task.list", { projectId: "p", pinned: true, limit: 1 });
    expect(first).toMatchObject({ data: [{ id: "c" }] });
    const next = await repository.catalog("task.list", {
      projectId: "p",
      pinned: true,
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(next).toMatchObject({ data: [{ id: "a" }], nextCursor: null });
  });
});

it("removes task preferences atomically with their directory", async () => {
  const root = await createWorkspace(),
    store = await openRepository(root);
  await store.catalog("project.put", {
    id: "p",
    name: "项目",
    path: root,
    createdAt: "2026-10-15T00:00:00Z",
  });
  await store.writeTaskSettings("p", "task", {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    model: "model",
    reasoningEffort: "high",
    sandboxMode: "workspace-write",
  });
  await store.catalog("project.remove", { id: "p" });
  expect(await store.readTaskSettings("p", "task")).toBeUndefined();
});
