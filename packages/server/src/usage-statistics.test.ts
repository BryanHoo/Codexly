import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStateRepository } from "./sqlite-state-repository.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function open() {
  const directory = await mkdtemp(join(tmpdir(), "codexly-usage-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const db = await SqliteStateRepository.open(join(directory, "state.sqlite3"));
  cleanups.push(() => db.close());
  return db;
}
test("deduplicates cumulative usage, separates cached input and retains unknown cache writes", async () => {
  const db = await open();
  const sample = {
    taskId: "task-1",
    source: "session-1",
    timestamp: "2026-10-22T10:00:00Z",
    tokenUsage: {
      total: { inputTokens: 1000, cachedInputTokens: 600, outputTokens: 100 },
      last: { inputTokens: 200, cachedInputTokens: 100, outputTokens: 30 },
    },
  };
  await db.catalog("usage.codex", sample);
  await db.catalog("usage.codex", sample);
  const next = {
    ...sample,
    tokenUsage: {
      ...sample.tokenUsage,
      total: { inputTokens: 1300, cachedInputTokens: 800, outputTokens: 150 },
    },
  };
  await db.catalog("usage.codex", next);
  const result = await db.catalog("usage.query", { year: 2026 });
  expect(result.days).toEqual([
    expect.objectContaining({
      day: "2026-10-22",
      engine: "codex",
      inputTokens: 200,
      outputTokens: 80,
      cacheReadTokens: 300,
      cacheWriteTokens: null,
      taskCount: 1,
    }),
  ]);
});
test("preserves missing fields and attributes incremental counters to their UTC day", async () => {
  const db = await open();
  await db.catalog("usage.record", {
    source: "request-1",
    taskId: "deleted",
    engine: "claude",
    totalTokens: 64,
    timestamp: "2025-12-31T23:59:59Z",
    inputTokens: 10,
    outputTokens: 4,
    cacheReadTokens: 30,
    cacheWriteTokens: 20,
  });
  await db.catalog("usage.record", {
    source: "request-1",
    taskId: "deleted",
    engine: "claude",
    totalTokens: 66,
    timestamp: "2026-01-01T00:00:00Z",
    inputTokens: 10,
    outputTokens: 6,
    cacheReadTokens: 30,
    cacheWriteTokens: 20,
  });
  expect((await db.catalog("usage.query", { year: 2025 })).days[0]).toMatchObject({
    inputTokens: 10,
    outputTokens: 4,
    cacheWriteTokens: 20,
    cacheReadTokens: 30,
  });
  expect((await db.catalog("usage.query", { year: 2026 })).days[0]).toMatchObject({
    inputTokens: 0,
    outputTokens: 2,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
  });
  expect((await db.catalog("usage.query", { year: 2026, engine: "codex" })).days).toEqual([]);
});

test("records total-only providers without manufacturing breakdowns and bounds day details", async () => {
  const db = await open();
  await db.catalog("usage.codex", {
    taskId: "total-only",
    source: "native",
    timestamp: "2026-10-22T00:00:00Z",
    tokenUsage: { total: { totalTokens: 1000 }, last: { totalTokens: 40 } },
  });
  const response = await db.catalog("usage.query", { year: 2026, day: "2026-10-22" });
  expect(response.days[0]).toMatchObject({
    totalTokens: 40,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
  });
  expect(response.tasks).toEqual([
    expect.objectContaining({ taskId: "total-only", totalTokens: 40 }),
  ]);
  for (let i = 0; i < 60; i += 1)
    await db.catalog("usage.record", {
      taskId: `task-${String(i)}`,
      source: `source-${String(i)}`,
      engine: "claude",
      timestamp: "2026-10-22T00:00:00Z",
      totalTokens: i + 1,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
    });
  expect((await db.catalog("usage.query", { year: 2026, day: "2026-10-22" })).tasks).toHaveLength(
    50,
  );
});

test("does not append WAL frames when only a duplicate notification timestamp changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codexly-usage-wal-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "state.sqlite3");
  const db = await SqliteStateRepository.open(path);
  cleanups.push(() => db.close());
  const input = {
    taskId: "t",
    source: "s",
    timestamp: "2026-10-22T00:00:00Z",
    tokenUsage: { total: { totalTokens: 100 }, last: { totalTokens: 100 } },
  };
  await db.catalog("usage.codex", input);
  const { stat } = await import("node:fs/promises");
  const before = (await stat(`${path}-wal`)).size;
  for (let i = 1; i < 5; i += 1)
    await db.catalog("usage.codex", { ...input, timestamp: `2026-10-22T00:00:0${String(i)}Z` });
  expect((await stat(`${path}-wal`)).size).toBe(before);
});

test("retains durable usage after reopening and after the original task is deleted", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codexly-usage-reopen-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "state.sqlite3");
  const first = await SqliteStateRepository.open(path);
  await first.catalog("task.put", {
    id: "original",
    projectId: null,
    title: "原任务",
    provider: "claude",
    cwd: directory,
    sessionId: "native",
    updatedAt: 1,
    pinned: false,
    archived: false,
    status: "idle",
  });
  await first.catalog("usage.record", {
    source: "native",
    taskId: "original",
    engine: "claude",
    timestamp: "2026-10-22T00:00:00Z",
    totalTokens: 42,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
  });
  await first.close();
  const reopened = await SqliteStateRepository.open(path);
  cleanups.push(() => reopened.close());
  expect(
    (await reopened.catalog("usage.query", { year: 2026, day: "2026-10-22" })).tasks[0],
  ).toMatchObject({ title: "原任务", totalTokens: 42 });
  await reopened.catalog("task.remove", { id: "original" });
  expect(
    (await reopened.catalog("usage.query", { year: 2026, day: "2026-10-22" })).tasks[0],
  ).toMatchObject({ taskId: "original", title: "", totalTokens: 42 });
});

test("does not backfill old classifications when a provider starts returning more fields", async () => {
  const db = await open();
  const common = {
    taskId: "task",
    source: "changing-provider",
    engine: "claude" as const,
    timestamp: "2026-10-22T00:00:00Z",
    cacheReadTokens: null,
    cacheWriteTokens: null,
  };
  await db.catalog("usage.record", {
    ...common,
    totalTokens: 100,
    inputTokens: null,
    outputTokens: null,
  });
  await db.catalog("usage.record", {
    ...common,
    totalTokens: 200,
    inputTokens: 150,
    outputTokens: 50,
  });
  expect((await db.catalog("usage.query", { year: 2026 })).days[0]).toMatchObject({
    totalTokens: 200,
    inputTokens: null,
    outputTokens: null,
  });
  await db.catalog("usage.record", {
    ...common,
    totalTokens: 250,
    inputTokens: 180,
    outputTokens: 70,
  });
  expect((await db.catalog("usage.query", { year: 2026 })).days[0]).toMatchObject({
    totalTokens: 250,
    inputTokens: 30,
    outputTokens: 20,
  });
});
