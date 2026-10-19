import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ClaudeConfiguration } from "./config.js";
import { checkpoint, createProjection, persist, type Running } from "./session.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "claude-revision-"));
  roots.push(directory);
  const config = new ClaudeConfiguration(directory);
  const { projection } = createProjection("task", "turn", "hello", vi.fn());
  const running = { projection, projections: new Map([[projection.id, projection]]) } as Running;
  return { config, projection, running };
}
function begin(projection: ReturnType<typeof createProjection>["projection"]) {
  projection.receive({
    type: "stream_event",
    event: { type: "message_start", message: { id: "m" } },
  });
  projection.receive({
    type: "stream_event",
    event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  });
}
function delta(projection: ReturnType<typeof createProjection>["projection"], text: string) {
  projection.receive({
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
  });
}

it("skips stable projections before snapshotting and saves metadata changes independently", async () => {
  const { config, projection, running } = await setup();
  await checkpoint("task", projection, config);
  await persist("task", running, config);
  const snapshot = vi.spyOn(projection, "snapshot");
  const save = vi.spyOn(config.history, "checkpoint");
  const metadata = vi.spyOn(config.history, "saveMetadata");
  for (let i = 0; i < 3; i++) await persist("task", running, config);
  expect(snapshot).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(metadata).not.toHaveBeenCalled();
  projection.sessionInitialized = true;
  await persist("task", running, config);
  expect(metadata).toHaveBeenCalledTimes(1);
  expect(snapshot).not.toHaveBeenCalled();
});

it("retains the newer dirty revision when tokens arrive during a checkpoint", async () => {
  const { config, projection, running } = await setup();
  begin(projection);
  delta(projection, "before");
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const original = config.history.checkpoint.bind(config.history);
  vi.spyOn(config.history, "checkpoint").mockImplementationOnce(async (...args) => {
    entered.resolve(undefined);
    await release.promise;
    return original(...args);
  });
  const writing = checkpoint("task", projection, config);
  await entered.promise;
  delta(projection, "after");
  release.resolve(undefined);
  await writing;
  expect(projection.changes.pendingItems()).toEqual([
    expect.objectContaining({ text: "beforeafter" }),
  ]);
  await persist("task", running, config);
  expect(projection.changes.pendingItems()).toEqual([]);
  expect((await config.history.items.read("task", "turn"))?.items.at(-1)).toMatchObject({
    text: "beforeafter",
  });
});

it("retries a failed checkpoint without acknowledging dirty items or its revision", async () => {
  const { config, projection, running } = await setup();
  await checkpoint("task", projection, config);
  begin(projection);
  delta(projection, "retry");
  vi.spyOn(config.history, "checkpoint").mockRejectedValueOnce(new Error("disk full"));
  await expect(persist("task", running, config)).rejects.toThrow("disk full");
  expect(projection.changes.pendingItems()).toHaveLength(1);
  await persist("task", running, config);
  expect(projection.changes.pendingItems()).toEqual([]);
  expect((await config.history.active("task"))?.items.at(-1)).toMatchObject({ text: "retry" });
});

it("reads through a fixed barrier without delaying later SDK writes", async () => {
  const { config } = await setup();
  const entered = Promise.withResolvers<undefined>(),
    release = Promise.withResolvers<undefined>();
  const original = config.history.items.save.bind(config.history.items);
  vi.spyOn(config.history.items, "save").mockImplementationOnce(async (...args) => {
    entered.resolve(undefined);
    await release.promise;
    return original(...args);
  });
  const writing = config.history.saveItems("task", "turn", [
    {
      id: "one",
      type: "message",
      role: "assistant",
      text: "first",
    },
  ]);
  await entered.promise;
  const reading = config.history.barrier("task");
  const laterEntered = Promise.withResolvers<undefined>(),
    laterRelease = Promise.withResolvers<undefined>();
  vi.spyOn(config.history.items, "save").mockImplementationOnce(async (...args) => {
    laterEntered.resolve(undefined);
    await laterRelease.promise;
    return original(...args);
  });
  const next = config.history.saveItems("task", "turn", [
    {
      id: "two",
      type: "message",
      role: "assistant",
      text: "second",
    },
  ]);
  release.resolve(undefined);
  await reading;
  await writing;
  await laterEntered.promise;
  // 后续写入仍被独立挂起，读取屏障已经完成，且没有占用写队列。
  laterRelease.resolve(undefined);
  await next;
  expect((await config.history.items.read("task", "turn"))?.items.map((item) => item.id)).toEqual([
    "one",
    "two",
  ]);
});

it("does not resettle a stable completed projection during background keepalive checkpoints", async () => {
  const { config, projection, running } = await setup();
  await checkpoint("task", projection, config);
  projection.receive({ type: "result", subtype: "success", result: "done" });
  await persist("task", running, config);
  const snapshot = vi.spyOn(projection, "snapshot");
  const settle = vi.spyOn(config.persistence, "settleAll");
  const save = vi.spyOn(config.history, "saveMetadata");
  for (let i = 0; i < 3; i++) await persist("task", running, config);
  expect(snapshot).not.toHaveBeenCalled();
  expect(settle).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
