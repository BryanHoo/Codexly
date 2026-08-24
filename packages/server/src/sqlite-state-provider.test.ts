import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { SqliteStateRepository } from "./sqlite-state-repository.js";
import {
  repositories,
  createWorkspace,
  openRepository,
} from "./sqlite-state-repository.test-support.js";

describe("SQLite provider state", () => {
  it("persists non-sensitive provider connection metadata across repository restarts", async () => {
    const root = await createWorkspace();
    const databasePath = join(root, "state.sqlite3");
    const repository = await openRepository(root);
    const record = {
      customBaseUrl: "https://api.example.com/v1",
      customModels: {
        data: [
          {
            defaultReasoningEffort: "medium",
            description: "Custom model",
            displayName: "custom-model",
            id: "custom-model",
            isDefault: true,
            supportedReasoningEfforts: [{ description: "Medium", id: "medium" }],
          },
        ],
        nextCursor: null,
      },
      mode: "custom" as const,
      updatedAt: "2026-08-07T10:00:00.000Z",
    };

    await expect(repository.readProviderConnection()).resolves.toBeUndefined();
    await expect(repository.writeProviderConnection(record)).resolves.toEqual(record);
    await repository.close();
    repositories.splice(repositories.indexOf(repository), 1);

    const database = new Database(databasePath, { readonly: true });
    try {
      const columnNames = database
        .prepare("PRAGMA table_info(provider_connection)")
        .all()
        .map((column) => (column as { name: string }).name);
      expect(columnNames).toEqual([
        "id",
        "mode",
        "custom_base_url",
        "custom_models_json",
        "updated_at",
      ]);
    } finally {
      database.close();
    }

    const reopened = await openRepository(root);
    await expect(reopened.readProviderConnection()).resolves.toEqual(record);
  });

  it("rejects corrupted provider model JSON at the repository boundary", async () => {
    const root = await createWorkspace();
    const databasePath = join(root, "state.sqlite3");
    const repository = await openRepository(root);
    await repository.close();
    repositories.splice(repositories.indexOf(repository), 1);

    const database = new Database(databasePath);
    try {
      database
        .prepare(
          `INSERT INTO provider_connection (
             id, mode, custom_base_url, custom_models_json, updated_at
           ) VALUES (1, 'custom', 'https://api.example.com/v1', '{broken', ?)`,
        )
        .run("2026-08-07T10:00:00.000Z");
    } finally {
      database.close();
    }

    const reopened = await openRepository(root);
    await expect(reopened.readProviderConnection()).rejects.toThrow(/model JSON/u);
  });

  it("removes obsolete task metadata after migration", async () => {
    const root = await createWorkspace();
    const databasePath = join(root, "state.sqlite3");
    const repository = await SqliteStateRepository.open(databasePath);
    await repository.close();

    const database = new Database(databasePath, { readonly: true });
    try {
      expect(
        database.prepare("SELECT name FROM sqlite_master WHERE name = 'task_metadata'").get(),
      ).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("terminates an unresponsive worker after the request deadline", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root, {
      // 为 Worker 初始化预留稳定余量，同时保持关闭请求的测试等待有界。
      requestTimeoutMs: 200,
      workerUrl: new URL("../test/fixtures/unresponsive-sqlite-worker.mjs", import.meta.url),
    });

    await expect(repository.close()).rejects.toThrow(/close.*timed out/u);
  });

  it("waits for a responsive worker to finish cleanup and exit naturally", async () => {
    const root = await createWorkspace();
    const databasePath = join(root, "state.sqlite3");
    const repository = await SqliteStateRepository.open(databasePath, {
      requestTimeoutMs: 200,
      workerUrl: new URL("../test/fixtures/graceful-sqlite-worker.mjs", import.meta.url),
    });

    await repository.close();

    await expect(readFile(`${databasePath}.closed`, "utf8")).resolves.toBe("closed");
  });
});
