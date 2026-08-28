import { describe, expect, it } from "vitest";

import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

describe("SQLite repository lifecycle", () => {
  it("recovers subsequent requests after a worker operation times out", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root, {
      requestTimeoutMs: 50,
      workerUrl: new URL("../test/fixtures/recovering-sqlite-worker.mjs", import.meta.url),
    });

    await expect(repository.list()).rejects.toThrow(/listProjects.*timed out/u);
    await expect(repository.list()).resolves.toEqual([]);
  });
});
