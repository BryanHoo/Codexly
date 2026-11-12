import { expect, it } from "vitest";
import { once } from "node:events";
import { join } from "node:path";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";
import type { LocalTask, LocalCatalogStore } from "@codexly/core";
const task: LocalTask = {
  id: "new",
  provider: "claude",
  projectId: null,
  title: "",
  cwd: "/workspace",
  sessionId: null,
  updatedAt: 1,
  pinned: false,
  archived: false,
  status: "idle",
};
const claim = (store: LocalCatalogStore, id = task.id, token = "one") =>
  store.catalog("acp.title.claim", { id, token, engine: "claude", projectId: null });
it("两连接只领取一次，手动命名及归档使在途标题失效，状态更新不误取消", async () => {
  const root = await createWorkspace();
  const a = await openRepository(root),
    b = await openRepository(root);
  await a.catalog("task.put", task);
  const claimed = await Promise.all([claim(a), claim(b, task.id, "two")]);
  expect(claimed).toEqual(expect.arrayContaining([true, false]));
  await a.catalog("task.patch", { id: task.id, status: "active", sessionId: "native" });
  await a.catalog("task.patch", { id: task.id, status: "idle" });
  expect(
    await b.catalog("acp.title.finish", { id: task.id, token: "wrong", title: "错误名称" }),
  ).toBeNull();
  await a.catalog("task.patch", { id: task.id, title: "用户命名" });
  expect(
    await b.catalog("acp.title.finish", {
      id: task.id,
      token: claimed[0] ? "one" : "two",
      title: "自动名称",
    }),
  ).toBeNull();
  expect((await a.catalog("task.read", { id: task.id }))?.title).toBe("用户命名");
  await a.catalog("task.put", { ...task, id: "auto" });
  expect(await claim(a, "auto")).toBe(true);
  await a.catalog("task.patch", { id: "auto", status: "active" });
  expect(await a.catalog("acp.title.finish", { id: "auto", token: "one", title: "自动名称" })).toBe(
    "自动名称",
  );
  await a.catalog("task.put", { ...task, id: "archive" });
  expect(await claim(a, "archive")).toBe(true);
  await a.catalog("task.patch", { id: "archive", archived: true });
  await a.catalog("task.patch", { id: "archive", archived: false });
  expect(
    await a.catalog("acp.title.finish", { id: "archive", token: "one", title: "过期名称" }),
  ).toBeNull();
});

it("初始化不回填旧空标题，不改变旧表列和版本，旧连接改名仍使领取失效", async () => {
  const { default: Database } = await import("better-sqlite3");
  const root = await createWorkspace(),
    initial = await openRepository(root);
  await initial.catalog("task.put", { ...task, id: "old-blank" });
  await initial.close();
  const old = new Database(join(root, "state.sqlite3"));
  try {
    old.exec(
      "DROP TRIGGER acp_task_titles_register; DROP TRIGGER acp_task_titles_invalidate; DROP TABLE acp_task_titles",
    );
    const columns = old.prepare("PRAGMA table_info(managed_tasks)").all(),
      version = old.pragma("user_version", { simple: true });
    const current = await openRepository(root);
    expect(await claim(current, "old-blank")).toBe(false);
    expect(old.prepare("PRAGMA table_info(managed_tasks)").all()).toEqual(columns);
    expect(old.pragma("user_version", { simple: true })).toBe(version);
    await current.catalog("task.put", { ...task, id: "legacy-writer" });
    expect(await claim(current, "legacy-writer")).toBe(true);
    old
      .prepare("UPDATE managed_tasks SET title=? WHERE id=?")
      .run("旧版本手动名称", "legacy-writer");
    expect(
      await current.catalog("acp.title.finish", {
        id: "legacy-writer",
        token: "one",
        title: "迟到名称",
      }),
    ).toBeNull();
    expect((await current.catalog("task.read", { id: "legacy-writer" }))?.title).toBe(
      "旧版本手动名称",
    );
  } finally {
    old.close();
  }
});
it("重启保留领取，已有原生会话和不属于范围的任务不生成标题", async () => {
  const root = await createWorkspace();
  const a = await openRepository(root);
  await a.catalog("task.put", task);
  expect(await claim(a)).toBe(true);
  const b = await openRepository(root);
  expect(await claim(b, task.id, "retry")).toBe(false);
  await a.catalog("task.put", { ...task, id: "history", sessionId: "old" });
  expect(await claim(b, "history")).toBe(false);
  await a.catalog("task.put", { ...task, id: "other" });
  expect(
    await b.catalog("acp.title.claim", {
      id: "other",
      token: "one",
      engine: "codex",
      projectId: null,
    }),
  ).toBe(false);
  expect(
    await b.catalog("acp.title.claim", {
      id: "other",
      token: "one",
      engine: "claude",
      projectId: "wrong",
    }),
  ).toBe(false);
  expect(await claim(b, "other")).toBe(true);
  await b.catalog("task.remove", { id: "other" });
  expect(
    await b.catalog("acp.title.finish", { id: "other", token: "one", title: "已删除" }),
  ).toBeNull();
});

it("状态补丁不能覆盖另一个连接正在提交的名称", async () => {
  const { default: Database } = await import("better-sqlite3");
  const { Worker } = await import("node:worker_threads");
  const root = await createWorkspace(),
    store = await openRepository(root);
  await store.catalog("task.put", { ...task, id: "race" });
  const writer = new Database(join(root, "state.sqlite3"));
  const worker = new Worker(
    new URL("./test-fixtures/catalog-title-race-worker.mjs", import.meta.url),
    { workerData: { path: join(root, "state.sqlite3") } },
  );
  try {
    await once(worker, "message");
    writer.exec("BEGIN IMMEDIATE; UPDATE managed_tasks SET title='手动名称' WHERE id='race'");
    const blocked = once(worker, "message");
    worker.postMessage({ run: true });
    await blocked;
    const completed = once(worker, "message");
    writer.exec("COMMIT");
    const messages: unknown[] = await completed;
    expect(messages[0]).toMatchObject({ result: { title: "手动名称", status: "idle" } });
  } finally {
    if (writer.inTransaction) writer.exec("ROLLBACK");
    writer.close();
    await worker.terminate();
  }
});
