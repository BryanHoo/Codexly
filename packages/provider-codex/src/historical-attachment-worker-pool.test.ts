import { expect, test } from "vitest";
import { RetainedWorkBudget } from "@codexly/core";

import {
  HistoricalAttachmentWorkerPool,
  type AttachmentWorkerJob,
} from "./historical-attachment-worker-pool.js";

const job: AttachmentWorkerJob = {
  operation: "persist",
  source: { type: "text", value: "hello" },
  kind: "text",
  maxBytes: 100,
  mediaType: "text/plain",
};

test("uses at most two workers and drains burst submissions without losing attachments", async () => {
  const workerUrl = new URL(
    `data:text/javascript,${encodeURIComponent(`
    import { parentPort, threadId } from 'node:worker_threads';
    let active = 0;
    parentPort.on('message', () => {
      active += 1;
      setTimeout(() => {
        parentPort.postMessage({ result: { blobKey: String(threadId), mediaType: 'text/plain', size: active } });
        active -= 1;
      }, 5);
    });
  `)}`,
  );
  const pool = new HistoricalAttachmentWorkerPool(2, workerUrl);
  try {
    const results = await Promise.all(Array.from({ length: 40 }, () => pool.run(job)));
    expect(new Set(results.map((result) => result.blobKey)).size).toBe(2);
    expect(results.every((result) => result.size === 1)).toBe(true);
  } finally {
    await pool.dispose();
  }
});

test("rejects active and queued work on dispose", async () => {
  const pool = new HistoricalAttachmentWorkerPool(1);
  const results = Promise.allSettled([pool.run(job), pool.run(job), pool.run(job)]);
  await pool.dispose();
  expect((await results).every((result) => result.status === "rejected")).toBe(true);
  await expect(pool.run(job)).rejects.toThrow("closed");
});

test("settles active and queued work when workers unexpectedly exit", async () => {
  const pool = new HistoricalAttachmentWorkerPool(
    1,
    new URL("data:text/javascript,process.exit(0)"),
  );
  try {
    const results = await Promise.allSettled([pool.run(job), pool.run(job)]);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
  } finally {
    await pool.dispose();
  }
});

const stalledWorker = new URL(
  "data:text/javascript,import { parentPort } from 'node:worker_threads'; parentPort.on('message', () => {});",
);

test("bounds active and queued jobs by task and process count and bytes across pools", async () => {
  const budget = new RetainedWorkBudget({
    maxCount: 3,
    maxBytes: 4096,
    maxTaskCount: 2,
    maxTaskBytes: 2048,
  });
  const first = new HistoricalAttachmentWorkerPool(1, stalledWorker, { budget });
  const second = new HistoricalAttachmentWorkerPool(1, stalledWorker, { budget });
  try {
    const pending = Promise.allSettled([
      first.run(job, { taskKey: "a" }),
      first.run(job, { taskKey: "a" }),
    ]);
    await expect(first.run(job, { taskKey: "a" })).rejects.toMatchObject({
      name: "AttachmentQueueFullError",
    });
    const other = Promise.allSettled([second.run(job, { taskKey: "b" })]);
    await expect(second.run(job, { taskKey: "c" })).rejects.toMatchObject({
      name: "AttachmentQueueFullError",
    });
    await expect(
      second.run({ ...job, source: { type: "text", value: "中".repeat(3000) } }, { taskKey: "d" }),
    ).rejects.toMatchObject({ name: "AttachmentQueueFullError" });
    await Promise.all([first.dispose(), second.dispose()]);
    await Promise.all([pending, other]);
    expect(budget.usage.count).toBe(0);
  } finally {
    await Promise.all([first.dispose(), second.dispose()]);
  }
});

test("times out real stalled workers and queued jobs and allows later recovery", async () => {
  const pool = new HistoricalAttachmentWorkerPool(1, stalledWorker, { timeoutMs: 100 });
  try {
    const results = await Promise.allSettled([pool.run(job), pool.run(job)]);
    expect(results).toMatchObject([
      { status: "rejected", reason: { name: "AttachmentJobTimeoutError" } },
      { status: "rejected", reason: { name: "AttachmentJobTimeoutError" } },
    ]);
    const controller = new AbortController();
    const canceled = pool.run(job, { signal: controller.signal });
    controller.abort();
    await expect(canceled).rejects.toMatchObject({ name: "AbortError" });
  } finally {
    await pool.dispose();
  }
});

test("removes canceled queued jobs immediately and reuses their budget", async () => {
  const budget = new RetainedWorkBudget({
    maxCount: 2,
    maxBytes: 4096,
    maxTaskCount: 2,
    maxTaskBytes: 4096,
  });
  const pool = new HistoricalAttachmentWorkerPool(1, stalledWorker, { budget });
  try {
    const active = Promise.allSettled([pool.run(job)]);
    const controller = new AbortController();
    const queued = pool.run(job, { signal: controller.signal });
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    expect(budget.usage.count).toBe(1);
    await pool.dispose();
    await active;
    expect(budget.usage.count).toBe(0);
  } finally {
    await pool.dispose();
  }
});

test("enforces task and process byte budgets independently of job counts", async () => {
  const budget = new RetainedWorkBudget({
    maxCount: 20,
    maxBytes: 7000,
    maxTaskCount: 10,
    maxTaskBytes: 5000,
  });
  const pool = new HistoricalAttachmentWorkerPool(1, stalledWorker, { budget });
  const large = { ...job, source: { type: "text" as const, value: "中".repeat(1200) } };
  try {
    const active = Promise.allSettled([pool.run(large, { taskKey: "a" })]);
    await expect(pool.run(large, { taskKey: "a" })).rejects.toMatchObject({
      name: "AttachmentQueueFullError",
    });
    const queued = Promise.allSettled([pool.run(large, { taskKey: "b" })]);
    await expect(pool.run(large, { taskKey: "c" })).rejects.toMatchObject({
      name: "AttachmentQueueFullError",
    });
    await pool.dispose();
    await Promise.all([active, queued]);
    expect(budget.usage).toEqual({ count: 0, bytes: 0 });
  } finally {
    await pool.dispose();
  }
});

test("cancels one task and resumes another task on a replacement worker", async () => {
  const workerUrl = new URL(
    `data:text/javascript,${encodeURIComponent(`
    import { parentPort } from 'node:worker_threads';
    parentPort.on('message', (job) => {
      if (job.source.value === 'stall') return;
      parentPort.postMessage({ result: { blobKey: 'recovered', mediaType: 'text/plain', size: 5 } });
    });
  `)}`,
  );
  const pool = new HistoricalAttachmentWorkerPool(1, workerUrl);
  try {
    const first = pool.run({ ...job, source: { type: "text", value: "stall" } }, { taskKey: "a" });
    const canceled = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const second = pool.run(job, { taskKey: "b" });
    await pool.cancelTask("a");
    await canceled;
    await expect(second).resolves.toMatchObject({ blobKey: "recovered" });
  } finally {
    await pool.dispose();
  }
});
