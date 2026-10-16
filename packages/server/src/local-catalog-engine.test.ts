import { describe, expect, it } from "vitest";
import type { LocalTask } from "@codexly/core";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

describe("immutable conversation execution binding", () => {
  it("persists Claude permission settings independently of Codex defaults", async () => {
    const root = await createWorkspace();
    const store = await openRepository(root);
    const settings = {
      model: "sonnet",
      reasoningEffort: "",
      approvalPolicy: "on-request" as const,
      approvalsReviewer: "user" as const,
      sandboxMode: "workspace-write" as const,
      engineOptions: { engine: "claude" as const, permissionMode: "acceptEdits" as const },
    };
    await store.writeTaskSettings("temporary", "claude", settings);
    await store.close();
    const reopened = await openRepository(root);
    expect(await reopened.readTaskSettings("temporary", "claude")).toEqual(settings);
  });
  it("rejects engine/project/session replacement and preserves bindings after restart", async () => {
    const root = await createWorkspace();
    const store = await openRepository(root);
    const task: LocalTask = {
      id: "claude-task",
      projectId: null,
      title: "Claude 会话",
      cwd: root,
      provider: "claude",
      sessionId: "shared-native-id",
      updatedAt: 100,
      pinned: false,
      archived: false,
      status: "idle",
    };
    await store.catalog("task.put", task);
    // 不同引擎可合法返回相同原生 ID，绝不能只按 sessionId 建立索引。
    await store.catalog("task.put", { ...task, id: "codex-task", provider: "codex" });
    for (const patch of [
      { provider: "codex" },
      { projectId: "other" },
      { sessionId: "other-native-id" },
    ]) {
      await expect(
        store.catalog("task.patch", {
          id: task.id,
          ...patch,
        }),
      ).rejects.toThrow(/immutable/i);
    }
    await expect(store.catalog("task.put", { ...task, provider: "codex" })).rejects.toThrow(
      /immutable/i,
    );
    await store.close();
    const reopened = await openRepository(root);
    expect(await reopened.catalog("task.read", { id: task.id })).toEqual(task);
  });

  it("binds a session exactly once and permits idempotent replay", async () => {
    const root = await createWorkspace();
    const store = await openRepository(root);
    await store.catalog("task.put", {
      id: "unbound",
      projectId: null,
      title: "新聊天",
      cwd: root,
      provider: "claude",
      sessionId: null,
      updatedAt: 100,
      pinned: false,
      archived: false,
      status: "idle",
    });
    await store.catalog("task.patch", { id: "unbound", sessionId: "native" });
    await expect(
      store.catalog("task.patch", { id: "unbound", sessionId: "native" }),
    ).resolves.toMatchObject({ sessionId: "native" });
    await expect(store.catalog("task.patch", { id: "unbound", sessionId: null })).rejects.toThrow(
      /immutable/i,
    );
  });
});

it("filters completed mixed-engine tasks before pagination", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  await store.catalog("project.put", {
    id: "p",
    name: "Project",
    path: root,
    createdAt: "2026-10-16T00:00:00Z",
  });
  for (const [index, status] of ["idle", "failed", "active", "notLoaded"].entries()) {
    await store.catalog("task.put", {
      id: `task-${String(index)}`,
      projectId: "p",
      title: status,
      cwd: root,
      provider: index % 2 ? "claude" : "codex",
      sessionId: null,
      updatedAt: index,
      pinned: false,
      archived: false,
      status,
    });
  }
  const page = await store.catalog("task.list", { projectId: "p", completed: true, limit: 1 });
  expect(page.data.map((task) => task.status)).toEqual(["notLoaded"]);
  const older = await store.catalog("task.list", {
    projectId: "p",
    completed: true,
    limit: 1,
    cursor: page.nextCursor,
  });
  expect(older.data.map((task) => task.status)).toEqual(["idle"]);
  expect(older.nextCursor).toBeNull();
});
