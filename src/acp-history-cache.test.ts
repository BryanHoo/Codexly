import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { AcpHistory, AcpStorageLeases } from "@codexly/provider-acp";
import {
  createWorkspace,
  openRepository,
} from "../packages/server/src/sqlite-state-repository.test-support.js";

it("真实 SQLite 两端连接保护读取及在途写入，释放后回收正文并支持重建", async () => {
  const root = await createWorkspace();
  const a = await openRepository(root);
  const b = await openRepository(root);
  const directory = join(root, "history");
  const history = new AcpHistory(directory, new AcpStorageLeases(a));
  const other = new AcpHistory(directory, new AcpStorageLeases(b), 0);
  const turn = {
    id: "turn",
    status: "completed" as const,
    startedAt: null,
    completedAt: null,
    error: null,
    items: [],
  };
  const release = await history.cache.acquire("task");
  await history.replace("task", [turn]);
  await history.cache.setReplayable("task", true);
  await other.cache.prune();
  expect((await other.read("task")).turns).toEqual([turn]);
  await release();
  const key = `history:${join(await realpath(directory), createHash("sha256").update("task").digest("hex"))}`;
  const writer = await new AcpStorageLeases(a).acquire(key);
  try {
    await other.cache.prune();
    expect((await other.read("task")).turns).toEqual([turn]);
  } finally {
    await writer();
  }
  await other.cache.prune();
  expect((await history.read("task")).turns).toEqual([]);
  expect(await history.cache.wasEvicted("task")).toBe(true);
  await history.replace("task", [turn]);
  expect(await history.cache.wasEvicted("task")).toBe(false);
});
