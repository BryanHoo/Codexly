import { describe, expect, it, vi } from "vitest";
import { AgentEventStream } from "./agent-event-stream.js";
import { AttachmentStore } from "./attachment-store.js";
import { createProvider } from "./app-provider.test-support.js";
import { createMemoryTaskQueueRepository } from "./memory-task-queue-repository.js";
import { PersistentTaskQueue } from "./persistent-task-queue.js";
import { snapshot, turnOptions } from "./app.test-support.js";

function setup() {
  const { provider, startTurn, steerTurn, readTask } = createProvider();
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
      resolveProviderInput: (_projectId, input) =>
        Promise.resolve({
          attachmentIds: [],
          providerInput: {
            files: [],
            images: [],
            skills: [],
            text: input.text,
            textAttachments: [],
          },
        }),
    });
  return { repository, runtime, createQueue, startTurn, steerTurn, readTask, attachmentStore };
}

const runningTurn = {
  id: "active-turn",
  status: "running" as const,
  items: [],
  error: null,
  startedAt: null,
  completedAt: null,
};
const prompt = { attachments: [], skills: [], text: "Run", type: "prompt" as const };

describe("resuming an edited queue", () => {
  it("saves the edited content and starts it without a second client request", async () => {
    const { runtime, createQueue, startTurn, repository } = setup();
    const queue = createQueue();
    const item = await queue.add(runtime, prompt, "message");
    await queue.update(runtime, item.id, prompt, "editing");
    await queue.update(runtime, item.id, { ...prompt, text: "Edited" }, "queued");
    expect(startTurn).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ text: "Edited" }),
      turnOptions,
    );
    expect(await repository.listQueue("temporary", "task-1")).toEqual([]);
  });

  it("resumes from the head instead of bypassing earlier queued messages", async () => {
    const { runtime, createQueue, startTurn, repository } = setup();
    const queue = createQueue();
    await queue.add(runtime, { ...prompt, text: "First" }, "first");
    const second = await queue.add(runtime, prompt, "second");
    await queue.update(runtime, second.id, prompt, "editing");
    await queue.update(runtime, second.id, prompt, "queued");
    expect(startTurn).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ text: "First" }),
      turnOptions,
    );
    expect((await repository.listQueue("temporary", "task-1")).map((item) => item.id)).toEqual([
      second.id,
    ]);
  });

  it("keeps the saved item queued while the provider is running", async () => {
    const { runtime, createQueue, startTurn, steerTurn, readTask, repository } = setup();
    const queue = createQueue();
    const item = await queue.add(runtime, prompt, "message");
    await queue.update(runtime, item.id, prompt, "editing");
    readTask.mockResolvedValue({ ...snapshot, turns: [runningTurn] });
    await queue.update(runtime, item.id, prompt, "queued");
    expect(startTurn).not.toHaveBeenCalled();
    expect(steerTurn).not.toHaveBeenCalled();
    expect(await repository.listQueue("temporary", "task-1")).toMatchObject([
      { id: item.id, status: "queued" },
    ]);
  });

  it("preserves an earlier editing barrier when saving a later item", async () => {
    const { runtime, createQueue, startTurn } = setup();
    const queue = createQueue();
    const first = await queue.add(runtime, prompt, "first");
    const second = await queue.add(runtime, prompt, "second");
    await queue.update(runtime, first.id, prompt, "editing");
    await queue.update(runtime, second.id, prompt, "editing");
    await expect(queue.update(runtime, second.id, prompt, "queued")).resolves.toMatchObject({
      status: "queued",
    });
    expect(startTurn).not.toHaveBeenCalled();
  });
});

describe("server-owned queue dispatch", () => {
  it("steers a running turn and transfers attachments before removing the queue record", async () => {
    const { runtime, createQueue, readTask, steerTurn, startTurn, repository, attachmentStore } =
      setup();
    readTask.mockResolvedValue({ ...snapshot, turns: [runningTurn] });
    const queue = createQueue();
    const item = await queue.add(runtime, prompt, "message");
    const transfer = vi.spyOn(attachmentStore, "startQueue");
    steerTurn.mockImplementation(async () => {
      expect((await repository.listQueue("temporary", "task-1"))[0]?.execution).toEqual({
        state: "starting",
      });
    });
    await expect(queue.start(runtime, item.id)).resolves.toEqual(runningTurn);
    expect(steerTurn).toHaveBeenCalledWith(
      "task-1",
      "active-turn",
      expect.objectContaining({ text: "Run" }),
    );
    expect(startTurn).not.toHaveBeenCalled();
    expect(transfer).toHaveBeenCalledWith("temporary", item.id, "active-turn");
    expect(await repository.listQueue("temporary", "task-1")).toEqual([]);
  });

  it("does not steer during automatic queue advancement", async () => {
    const { runtime, createQueue, readTask, steerTurn, startTurn, repository } = setup();
    readTask.mockResolvedValue({ ...snapshot, turns: [runningTurn] });
    const queue = createQueue();
    await queue.add(runtime, prompt, "message");
    await expect(queue.startNext(runtime)).resolves.toBeUndefined();
    expect(startTurn).not.toHaveBeenCalled();
    expect(steerTurn).not.toHaveBeenCalled();
    expect(await repository.listQueue("temporary", "task-1")).toHaveLength(1);
  });

  it("recovers successful steering cleanup across restart without a second delivery", async () => {
    const { runtime, createQueue, readTask, steerTurn, repository } = setup();
    readTask.mockResolvedValue({ ...snapshot, turns: [runningTurn] });
    const queue = createQueue();
    const item = await queue.add(runtime, prompt, "message");
    vi.spyOn(repository, "deleteQueue").mockRejectedValueOnce(new Error("delete failed"));
    await expect(queue.start(runtime, item.id)).rejects.toThrow("delete failed");
    await expect(createQueue().start(runtime, item.id)).resolves.toEqual(runningTurn);
    expect(steerTurn).toHaveBeenCalledOnce();
  });

  it("keeps an unknown steer result blocked after restart", async () => {
    const { runtime, createQueue, readTask, steerTurn, startTurn } = setup();
    readTask.mockResolvedValue({ ...snapshot, turns: [runningTurn] });
    const queue = createQueue();
    const item = await queue.add(runtime, prompt, "message");
    steerTurn.mockRejectedValueOnce(new Error("response lost"));
    await expect(queue.start(runtime, item.id)).rejects.toThrow("response lost");
    await expect(createQueue().start(runtime, item.id)).rejects.toThrow("blocked");
    expect(steerTurn).toHaveBeenCalledOnce();
    expect(startTurn).not.toHaveBeenCalled();
  });
});

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
