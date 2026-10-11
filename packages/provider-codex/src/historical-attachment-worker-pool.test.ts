import { expect, test } from "vitest";

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
    pool.dispose();
  }
});

test("rejects active and queued work on dispose", async () => {
  const pool = new HistoricalAttachmentWorkerPool(1);
  const results = Promise.allSettled([pool.run(job), pool.run(job), pool.run(job)]);
  pool.dispose();
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
    pool.dispose();
  }
});
