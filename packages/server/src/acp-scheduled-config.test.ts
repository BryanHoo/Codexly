import Database from "better-sqlite3";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

const key = { source: "web" as const, scheduleId: "same-plan" };
const input = {
  ...key,
  expectedRevision: 0,
  engine: "claude" as const,
  values: { mode: false, nativeModel: "raw" },
};

it("定时 ACP 配置隔离来源，修订号避免并发覆盖，重开后仍可读取", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  const other = await openRepository(root);
  expect(await store.catalog("acp.schedule.read", key)).toBeNull();
  const first = await store.catalog("acp.schedule.set", input);
  expect(first).toEqual({ ...key, engine: "claude", values: input.values, revision: 1 });
  const writes = await Promise.all(
    [store, other].map((repository) =>
      repository.catalog("acp.schedule.set", {
        ...input,
        expectedRevision: 1,
        values: { mode: true },
      }),
    ),
  );
  expect(writes.filter((value) => value !== null)).toHaveLength(1);
  expect(await store.catalog("acp.schedule.set", { ...input, source: "desktop" })).toMatchObject({
    revision: 1,
  });
  await store.close();
  const reopened = await openRepository(root);
  expect(await reopened.catalog("acp.schedule.read", key)).toMatchObject({
    revision: 2,
    values: { mode: true },
  });
  expect(await reopened.catalog("acp.schedule.delete", { ...key, expectedRevision: 1 })).toBe(
    false,
  );
  expect(await reopened.catalog("acp.schedule.delete", { ...key, expectedRevision: 2 })).toBe(true);
  expect(await reopened.catalog("acp.schedule.read", key)).toBeNull();
  expect(await reopened.catalog("acp.schedule.read", { ...key, source: "desktop" })).toMatchObject({
    revision: 1,
  });
});

it("新增配置表不修改旧计划或目录版本，非法值不落盘", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  const db = new Database(join(root, "state.sqlite3"));
  try {
    const original = db.prepare("SELECT tasks_json FROM scheduled_task_state WHERE id=1").get();
    const version = db.pragma("user_version", { simple: true });
    await store.catalog("acp.schedule.set", input);
    for (const values of [
      { bad: { value: 1 } },
      { ["😀".repeat(129)]: true },
      { long: "x".repeat(16385) },
    ]) {
      await expect(
        store.catalog("acp.schedule.set", {
          ...input,
          expectedRevision: 1,
          values,
        } as unknown as typeof input),
      ).rejects.toThrow();
    }
    expect(await store.catalog("acp.schedule.read", key)).toMatchObject({
      revision: 1,
      values: input.values,
    });
    expect(db.prepare("SELECT tasks_json FROM scheduled_task_state WHERE id=1").get()).toEqual(
      original,
    );
    expect(db.pragma("user_version", { simple: true })).toBe(version);
  } finally {
    db.close();
  }
});

it("配置数量及字节预算在 SQLite 写入边界强制执行", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  const db = new Database(join(root, "state.sqlite3"));
  try {
    const oversized = Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [String(index), "x".repeat(16384)]),
    );
    await expect(
      store.catalog("acp.schedule.set", { ...input, values: oversized }),
    ).rejects.toThrow("capacity");
    const insert = db.prepare("INSERT INTO acp_scheduled_configs VALUES ('web',?,'codex',?,1)");
    db.transaction(() => {
      for (let index = 0; index < 1000; index++) insert.run(String(index), "{}");
    })();
    await expect(store.catalog("acp.schedule.set", input)).rejects.toThrow("capacity");
    expect(await store.catalog("acp.schedule.read", key)).toBeNull();
    expect(
      await store.catalog("acp.schedule.set", { ...input, scheduleId: "0", expectedRevision: 1 }),
    ).toMatchObject({ revision: 2 });
    db.exec("DELETE FROM acp_scheduled_configs");
    const large = JSON.stringify(
      Object.fromEntries(
        Array.from({ length: 16 }, (_, index) => [String(index), "x".repeat(16000)]),
      ),
    );
    db.transaction(() => {
      for (let index = 0; index < 65; index++) insert.run(String(index), large);
    })();
    await expect(
      store.catalog("acp.schedule.set", {
        ...input,
        values: JSON.parse(large) as Record<string, string>,
      }),
    ).rejects.toThrow("capacity");
  } finally {
    db.close();
  }
});

it("落盘配置损坏时明确失败，不替换为全局默认值", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  await store.catalog("acp.schedule.set", input);
  const db = new Database(join(root, "state.sqlite3"));
  try {
    db.prepare("UPDATE acp_scheduled_configs SET values_json=?").run('{"bad":{}}');
    await expect(store.catalog("acp.schedule.read", key)).rejects.toThrow("Invalid ACP");
  } finally {
    db.close();
  }
});
