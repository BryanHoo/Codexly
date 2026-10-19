import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentProviderEventListener } from "@codexly/core";
import type { ClaudeAgentProvider } from "./provider.js";
import { ClaudeConfiguration } from "./config.js";
import { ClaudeHostQueue } from "./host-queue.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "claude-host-queue-"));
  roots.push(root);
  const listeners = new Set<AgentProviderEventListener>();
  let running = true;
  const startTurn = vi.fn(() => {
    running = true;
    return Promise.resolve({
      id: "next",
      status: "running",
      items: [],
      error: null,
      startedAt: null,
      completedAt: null,
    });
  });
  const steerTurn = vi.fn(() => Promise.resolve());
  const provider = {
    scope: { id: "p" },
    config: new ClaudeConfiguration(root),
    subscribeEvents: (listener: AgentProviderEventListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readTaskMetadata: () => Promise.resolve({ id: "t" }),
    readTask: () =>
      Promise.resolve({
        turns: running
          ? [
              {
                id: "current",
                status: "running",
                items: [],
                error: null,
                startedAt: null,
                completedAt: null,
              },
            ]
          : [],
      }),
    startTurn,
    steerTurn,
  } as unknown as ClaudeAgentProvider;
  provider.readTaskAttachment = (task, id) => provider.config.attachments.read(task, id);
  const events: unknown[] = [];
  const create = () =>
    new ClaudeHostQueue(
      root,
      () => Promise.resolve({ model: "default" } as never),
      (event) => events.push(event),
    );
  const queue = create();
  const add = (text: string) =>
    queue.execute(provider, "queue.add", {
      taskId: "t",
      input: { text, files: [], images: [], skills: [], textAttachments: [] },
      clientUserMessageId: text,
    });
  return {
    root,
    queue,
    provider,
    startTurn,
    steerTurn,
    events,
    create,
    add,
    complete: () => {
      return Promise.resolve().then(() => {
        running = false;
        for (const listener of listeners)
          listener({
            type: "turn.completed",
            taskId: "t",
            turnId: "current",
            payload: {
              turn: {
                id: "current",
                status: "completed",
                items: [],
                error: null,
                startedAt: null,
                completedAt: null,
              },
            },
          });
      });
    },
  };
}

it("persists and moves queued messages, then dispatches only the head when the active turn completes", async () => {
  const h = await setup();
  const first = await h.add("first");
  const second = await h.add("second");
  expect(h.startTurn).not.toHaveBeenCalled();
  await h.queue.execute(h.provider, "queue.move", {
    taskId: "t",
    queuedSubmissionId: second.queuedSubmission?.id,
    offset: -1,
  });
  const restored = await h.create().execute(h.provider, "queue.list", { taskId: "t" });
  expect(restored.data?.map((entry: { text: string }) => entry.text)).toEqual(["second", "first"]);
  await h.complete();
  await vi.waitFor(() => {
    expect(h.startTurn).toHaveBeenCalledOnce();
  });
  expect(h.startTurn.mock.calls[0]).toMatchObject(["t", { text: "second" }, { model: "default" }]);
  await vi.waitFor(async () => {
    expect((await h.queue.execute(h.provider, "queue.list", { taskId: "t" })).data).toHaveLength(1);
  });
  expect(h.steerTurn).not.toHaveBeenCalled();
  expect(first.queuedSubmission?.id).toBeTruthy();
});

it("steers a selected queued message and removes it without starting another turn", async () => {
  const h = await setup();
  const added = await h.add("correct course");
  const params = { taskId: "t", queuedSubmissionId: added.queuedSubmission?.id };
  await h.queue.execute(h.provider, "queue.start", params);
  expect(h.steerTurn).toHaveBeenCalledExactlyOnceWith(
    "t",
    "current",
    expect.objectContaining({ text: "correct course" }),
  );
  expect(h.startTurn).not.toHaveBeenCalled();
  expect((await h.queue.execute(h.provider, "queue.list", { taskId: "t" })).data).toEqual([]);
});

it("rejects a queued steer targeting a stale turn and preserves the queued item", async () => {
  const h = await setup();
  const added = await h.add("stay queued");
  await expect(
    h.queue.execute(h.provider, "queue.steer", {
      taskId: "t",
      turnId: "stale",
      queuedSubmissionId: added.queuedSubmission?.id,
    }),
  ).rejects.toThrow();
  expect(h.steerTurn).not.toHaveBeenCalled();
  expect((await h.queue.execute(h.provider, "queue.list", { taskId: "t" })).data).toHaveLength(1);
});

it("restores queued attachment metadata and contents after reconstructing the host queue", async () => {
  const h = await setup();
  const added = await h.queue.execute(h.provider, "queue.add", {
    taskId: "t",
    clientUserMessageId: "with-text",
    input: {
      text: "read attachment",
      images: [],
      files: [],
      skills: [],
      textAttachments: [{ name: "context.txt", text: "retained queue context" }],
    },
  });
  const restored = h.create();
  const listing = await restored.execute(h.provider, "queue.list", { taskId: "t" });
  expect(listing.data?.[0]?.attachments).toMatchObject([{ kind: "text", name: "context.txt" }]);
  await restored.execute(h.provider, "queue.steer", {
    taskId: "t",
    turnId: "current",
    queuedSubmissionId: added.queuedSubmission?.id,
  });
  expect(h.steerTurn).toHaveBeenCalledExactlyOnceWith(
    "t",
    "current",
    expect.objectContaining({
      textAttachments: [{ name: "context.txt", text: "retained queue context" }],
    }),
  );
});
