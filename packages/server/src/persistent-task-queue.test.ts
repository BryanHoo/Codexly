import { describe, expect, it, vi } from "vitest";
import { AgentEventStream } from "./agent-event-stream.js";
import { AttachmentStore } from "./attachment-store.js";
import { createProvider } from "./app-provider.test-support.js";
import { createMemoryTaskQueueRepository } from "./memory-task-queue-repository.js";
import { PersistentTaskQueue } from "./persistent-task-queue.js";
import { turnOptions } from "./app.test-support.js";

function setup() {
  const { provider, startTurn } = createProvider();
  const repository = createMemoryTaskQueueRepository();
  const attachmentStore = new AttachmentStore();
  const runtime = {
    provider,
    projectId: "temporary",
    taskId: "task-1",
    eventStream: new AgentEventStream({ provider: "codex", sessionId: "session" }),
  };
  const createQueue = () =>
    new PersistentTaskQueue({
      repository,
      attachmentStore,
      readTaskSettings: () => Promise.resolve(turnOptions),
      resolveProviderInput: () =>
        Promise.resolve({
          attachmentIds: [],
          providerInput: {
            files: [],
            images: [],
            skills: [],
            text: "Run",
            textAttachments: [],
          },
        }),
    });
  return { repository, runtime, createQueue, startTurn, attachmentStore };
}

describe("persistent queue execution recovery", () => {
  it("retries only the result write after launch succeeds", async () => {
    const { repository, runtime, createQueue, startTurn } = setup();
    const queue = createQueue();
    const item = await queue.add(
      runtime,
      { attachments: [], skills: [], text: "Run", type: "prompt" },
      "message",
    );
    const write = repository.setQueueExecution.bind(repository);
    vi.spyOn(repository, "setQueueExecution")
      .mockImplementationOnce(write)
      .mockRejectedValueOnce(new Error("result write failed"));
    await expect(queue.start(runtime, item.id)).rejects.toThrow("result write failed");
    await expect(queue.start(runtime, item.id)).resolves.toMatchObject({ id: "turn-1" });
    expect(startTurn).toHaveBeenCalledOnce();
  });

  it("never launches before the execution claim is durable", async () => {
    const { repository, runtime, createQueue, startTurn } = setup();
    const queue = createQueue();
    const item = await queue.add(
      runtime,
      { attachments: [], skills: [], text: "Run", type: "prompt" },
      "message",
    );
    vi.spyOn(repository, "setQueueExecution").mockRejectedValueOnce(new Error("claim failed"));
    await expect(queue.start(runtime, item.id)).rejects.toThrow("claim failed");
    expect(startTurn).not.toHaveBeenCalled();
    await queue.start(runtime, item.id);
    expect(startTurn).toHaveBeenCalledOnce();
  });

  it("recovers a started turn after deletion fails and the queue service restarts", async () => {
    const { repository, runtime, createQueue, startTurn } = setup();
    const queue = createQueue();
    const item = await queue.add(
      runtime,
      { attachments: [], skills: [], text: "Run", type: "prompt" },
      "message",
    );
    vi.spyOn(repository, "deleteQueue").mockRejectedValueOnce(new Error("disk failure"));
    await expect(queue.start(runtime, item.id)).rejects.toThrow("disk failure");
    const recovered = await createQueue().start(runtime, item.id);
    expect(recovered.id).toBe("turn-1");
    expect(startTurn).toHaveBeenCalledOnce();
    expect(await repository.listQueue(runtime.projectId, runtime.taskId)).toEqual([]);
  });

  it("does not retry an ambiguous provider failure, even after editing the record", async () => {
    const { runtime, createQueue, startTurn } = setup();
    const queue = createQueue();
    const input = { attachments: [], skills: [], text: "Run", type: "prompt" as const };
    const item = await queue.add(runtime, input, "message");
    startTurn.mockRejectedValueOnce(new Error("response lost"));
    await expect(queue.start(runtime, item.id)).rejects.toThrow("response lost");
    await expect(queue.update(runtime, item.id, input, "queued")).rejects.toThrow();
    await expect(createQueue().start(runtime, item.id)).rejects.toThrow();
    expect(startTurn).toHaveBeenCalledOnce();
  });
});
