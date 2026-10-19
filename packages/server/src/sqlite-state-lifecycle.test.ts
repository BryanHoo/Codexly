import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { describe, expect, it } from "vitest";

import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

describe("SQLite repository lifecycle", () => {
  it("recovers subsequent requests after a worker operation times out", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root, {
      // 此用例验证阻塞后的恢复，不把 Windows Worker 启动耗时限制在 50ms 内。
      requestTimeoutMs: 1_000,
      workerUrl: new URL("../test/fixtures/recovering-sqlite-worker.mjs", import.meta.url),
    });

    await expect(repository.list()).rejects.toThrow(/listProjects.*timed out/u);
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("recovers the same instance after a real replacement worker fails to start", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root, {
      requestTimeoutMs: 1_000,
      workerUrl: new URL("../test/fixtures/flaky-sqlite-worker.mjs", import.meta.url),
    });
    const firstRead = repository.list();
    // 在超时发生前安排后续读取，确保它等待第二代启动而非错过失败窗口。
    const replacementRead = expect(firstRead.catch(() => repository.list())).rejects.toMatchObject({
      code: "SQLITE_CANTOPEN",
      message: "temporary startup failure",
    });
    await expect(firstRead).rejects.toThrow(/listProjects.*timed out/u);
    await replacementRead;
    await setTimeout(110);

    await expect(
      Promise.all([repository.list(), repository.listQueue("project", "task")]),
    ).resolves.toEqual([[], []]);
    await expect(readFile(join(root, "state.sqlite3.start-count"), "utf8")).resolves.toBe("3");
  });
});
