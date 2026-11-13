import { expect, it } from "vitest";
import { join } from "node:path";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

it("存储锁只允许一个连接领取，接管和迟到释放均核对原 owner", async () => {
  const root = await createWorkspace();
  const a = await openRepository(root),
    b = await openRepository(root);
  const claim = { key: "history/task", owner: "first", pid: process.pid, expectedOwner: null };
  expect(await a.catalog("acp.storage.read", { key: claim.key })).toBeNull();
  const claims = await Promise.all([
    a.catalog("acp.storage.claim", claim),
    b.catalog("acp.storage.claim", { ...claim, owner: "other" }),
  ]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const current = await a.catalog("acp.storage.read", { key: claim.key });
  if (!current) throw new Error("锁未写入");
  expect(
    await b.catalog("acp.storage.claim", { ...claim, owner: "next", expectedOwner: current.owner }),
  ).toBe(true);
  expect(await a.catalog("acp.storage.release", { key: claim.key, owner: current.owner })).toBe(
    false,
  );
  expect(
    await a.catalog("acp.storage.claim", { ...claim, owner: "late", expectedOwner: current.owner }),
  ).toBe(false);
  expect(await a.catalog("acp.storage.read", { key: claim.key })).toEqual({
    owner: "next",
    pid: process.pid,
  });
  expect(await b.catalog("acp.storage.release", { key: claim.key, owner: "next" })).toBe(true);
  expect(
    await a.catalog("acp.storage.claim", { ...claim, owner: "late", expectedOwner: current.owner }),
  ).toBe(false);
  expect(await a.catalog("acp.storage.read", { key: claim.key })).toBeNull();
});

it("存储锁是私有增量表，不修改旧版本、表列或旧任务", async () => {
  const { default: Database } = await import("better-sqlite3");
  const root = await createWorkspace();
  const store = await openRepository(root);
  const old = new Database(join(root, "state.sqlite3"));
  try {
    const version = old.pragma("user_version", { simple: true });
    const columns = old.prepare("PRAGMA table_info(managed_tasks)").all();
    await store.catalog("acp.storage.claim", {
      key: "settings/codex",
      owner: "one",
      pid: process.pid,
      expectedOwner: null,
    });
    expect(old.pragma("user_version", { simple: true })).toBe(version);
    expect(old.prepare("PRAGMA table_info(managed_tasks)").all()).toEqual(columns);
    await expect(
      store.catalog("acp.storage.claim", {
        key: "bad",
        owner: "one",
        pid: -1,
        expectedOwner: null,
      }),
    ).rejects.toThrow();
    expect(await store.catalog("acp.storage.read", { key: "bad" })).toBeNull();
  } finally {
    old.close();
  }
});

it("4096 项饱和时拒绝新资源，仍允许按原 owner 接管和释放", async () => {
  const { default: Database } = await import("better-sqlite3");
  const root = await createWorkspace();
  const store = await openRepository(root);
  const old = new Database(join(root, "state.sqlite3"));
  try {
    await store.catalog("acp.storage.claim", {
      key: "retained",
      owner: "old",
      pid: process.pid,
      expectedOwner: null,
    });
    old.exec(
      "WITH RECURSIVE c(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM c WHERE n<4095) INSERT INTO acp_storage_locks SELECT 'resource-'||n,'owner-'||n,1 FROM c",
    );
    expect(
      await store.catalog("acp.storage.claim", {
        key: "overflow",
        owner: "new",
        pid: process.pid,
        expectedOwner: null,
      }),
    ).toBe(false);
    expect(
      await store.catalog("acp.storage.claim", {
        key: "retained",
        owner: "next",
        pid: process.pid,
        expectedOwner: "old",
      }),
    ).toBe(true);
    expect(await store.catalog("acp.storage.release", { key: "retained", owner: "next" })).toBe(
      true,
    );
    expect(
      await store.catalog("acp.storage.claim", {
        key: "overflow",
        owner: "new",
        pid: process.pid,
        expectedOwner: null,
      }),
    ).toBe(true);
  } finally {
    old.close();
  }
});
