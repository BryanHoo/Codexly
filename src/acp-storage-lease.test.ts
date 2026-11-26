import { expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { AcpStorageLeases, AcpRuntime, AcpHistory } from "@codexly/provider-acp";
import {
  createWorkspace,
  openRepository,
} from "../packages/server/src/sqlite-state-repository.test-support.js";

it("进程退出后两个连接竞争接管，恰有一个成功，旧释放不能删除新锁", async () => {
  const root = await createWorkspace();
  const a = await openRepository(root),
    b = await openRepository(root);
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    await once(child, "spawn");
    if (!child.pid) throw new Error("子进程未启动");
    await a.catalog("acp.storage.claim", {
      key: "history/task",
      owner: "dead",
      pid: child.pid,
      expectedOwner: null,
    });
    await expect(new AcpStorageLeases(b).acquire("history/task")).rejects.toThrow("正在写入");
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    const attempts = await Promise.allSettled([
      new AcpStorageLeases(a).acquire("history/task"),
      new AcpStorageLeases(b).acquire("history/task"),
    ]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await a.catalog("acp.storage.release", { key: "history/task", owner: "dead" })).toBe(
      false,
    );
    const acquired = attempts.find((result) => result.status === "fulfilled");
    if (acquired?.status !== "fulfilled") throw new Error("未取得恢复锁");
    await acquired.value();
    expect(await a.catalog("acp.storage.read", { key: "history/task" })).toBeNull();
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
});

it("存活判断权限不足时拒绝接管，不修改原 owner", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  await store.catalog("acp.storage.claim", {
    key: "settings",
    owner: "live",
    pid: process.pid,
    expectedOwner: null,
  });
  const probe = vi.spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("denied"), { code: "EPERM" });
  });
  try {
    await expect(new AcpStorageLeases(store).acquire("settings")).rejects.toThrow("正在写入");
  } finally {
    probe.mockRestore();
  }
  expect(await store.catalog("acp.storage.read", { key: "settings" })).toEqual({
    owner: "live",
    pid: process.pid,
  });
});

it("生产运行时配置写入遵守共享锁，异常后释放且不覆盖已保存值", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  const runtime = new AcpRuntime(root, store);
  await mkdir(join(root, "settings"), { recursive: true });
  const key = `settings:${join(await realpath(root), "settings", "codex.json")}`;
  const release = await new AcpStorageLeases(store).acquire(key);
  try {
    await expect(
      runtime.settings.update("codex", (current) => ({ ...current, configured: true })),
    ).rejects.toThrow("正在写入");
    expect((await runtime.settings.read("codex")).configured).toBe(false);
  } finally {
    await release();
  }
  try {
    await expect(
      runtime.settings.update("codex", () => {
        throw new Error("配置校验失败");
      }),
    ).rejects.toThrow("配置校验失败");
    await runtime.settings.update("codex", (current) => ({ ...current, configured: true }));
    expect((await runtime.settings.read("codex")).configured).toBe(true);
    expect(await store.catalog("acp.storage.read", { key })).toBeNull();
  } finally {
    await runtime.close();
  }
});

it("历史重放竞争保留原指针，失败后可由另一连接写入", async () => {
  const root = await createWorkspace();
  const a = await openRepository(root),
    b = await openRepository(root);
  const directory = join(root, "history");
  const history = new AcpHistory(directory, new AcpStorageLeases(a));
  const other = new AcpHistory(directory, new AcpStorageLeases(b));
  const turn = {
    id: "old",
    status: "completed" as const,
    startedAt: null,
    completedAt: null,
    error: null,
    items: [],
  };
  await history.replace("task", [turn]);
  const key = `history:${join(await realpath(directory), createHash("sha256").update("task").digest("hex"))}`;
  const release = await new AcpStorageLeases(a).acquire(key);
  try {
    await expect(other.replace("task", [])).rejects.toThrow("正在写入");
    expect((await other.read("task")).turns).toEqual([turn]);
  } finally {
    await release();
  }
  await expect(
    history.replace(
      "task",
      (async function* () {
        await Promise.resolve();
        yield { ...turn, id: "partial" };
        throw new Error("重放中断");
      })(),
    ),
  ).rejects.toThrow("重放中断");
  await other.append("task", { ...turn, id: "new" });
  expect((await history.read("task")).turns.map((entry) => entry.id)).toEqual(["old", "new"]);
  expect(await a.catalog("acp.storage.read", { key })).toBeNull();
});

it("领取已经落盘但回执丢失时按本次 token 清理，不留下当前进程的孤锁", async () => {
  const root = await createWorkspace();
  const store = await openRepository(root);
  const catalog = store.catalog.bind(store);
  const request = vi.spyOn(store, "catalog").mockImplementation(async (operation, payload) => {
    const result = await catalog(operation, payload);
    if (operation === "acp.storage.claim") throw new Error("回执丢失");
    return result;
  });
  await expect(new AcpStorageLeases(store).acquire("unknown")).rejects.toThrow("回执丢失");
  request.mockRestore();
  expect(await store.catalog("acp.storage.read", { key: "unknown" })).toBeNull();
});
