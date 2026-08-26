import { randomUUID } from "node:crypto";

import type {
  AgentProvider,
  AgentProviderTurnInput,
  AgentQueueRecord,
  AgentQueueRepository,
} from "@codexly/core";
import type {
  AgentPromptInput,
  AgentQueuedSubmission,
  AgentQueuedSubmissionStatus,
  AgentTaskSettings,
  AgentTurn,
} from "@codexly/protocol";

import type { AgentEventStream } from "./agent-event-stream.js";
import type { AttachmentStore } from "./attachment-store.js";

export class TaskQueueBlockedError extends Error {
  public constructor() {
    super("Task queue is blocked by an edited submission");
    this.name = "TaskQueueBlockedError";
  }
}

export class TaskQueueItemNotFoundError extends Error {
  public constructor() {
    super("Queued submission was not found");
    this.name = "TaskQueueItemNotFoundError";
  }
}

type QueueRuntime = Readonly<{
  eventStream: AgentEventStream;
  projectId: string;
  provider: AgentProvider;
  taskId: string;
}>;

type PersistentTaskQueueOptions = Readonly<{
  attachmentStore: AttachmentStore;
  readTaskSettings: (projectId: string, taskId: string) => Promise<AgentTaskSettings>;
  repository: AgentQueueRepository;
  resolveProviderInput: (
    projectId: string,
    input: AgentPromptInput,
    provider: AgentProvider,
    taskId: string,
  ) => Promise<
    Readonly<{ attachmentIds: readonly string[]; providerInput: AgentProviderTurnInput }>
  >;
}>;

export class PersistentTaskQueue {
  readonly #attachmentStore: AttachmentStore;
  readonly #locks = new Map<string, Promise<void>>();
  readonly #readTaskSettings: PersistentTaskQueueOptions["readTaskSettings"];
  readonly #repository: AgentQueueRepository;
  readonly #resolveProviderInput: PersistentTaskQueueOptions["resolveProviderInput"];

  public constructor(options: PersistentTaskQueueOptions) {
    this.#attachmentStore = options.attachmentStore;
    this.#readTaskSettings = options.readTaskSettings;
    this.#repository = options.repository;
    this.#resolveProviderInput = options.resolveProviderInput;
  }

  public async add(
    runtime: QueueRuntime,
    input: AgentPromptInput,
    clientUserMessageId: string,
  ): Promise<AgentQueuedSubmission> {
    const { attachmentIds } = await this.#resolveProviderInput(
      runtime.projectId,
      input,
      runtime.provider,
      runtime.taskId,
    );
    const storedInput = { ...input, attachments: attachmentIds.map((id) => ({ id })) };
    const record = await this.#repository.addQueue({
      clientUserMessageId,
      id: randomUUID(),
      input: storedInput,
      projectId: runtime.projectId,
      status: "queued",
      taskId: runtime.taskId,
    });
    await this.#attachmentStore.retainQueue(runtime.projectId, attachmentIds, record.id);
    this.#publishChanged(runtime);
    return this.#mapRecord(record);
  }

  public async delete(runtime: QueueRuntime, queuedSubmissionId: string): Promise<boolean> {
    return this.#withTaskLock(runtime, async () => {
      const deleted = await this.#repository.deleteQueue(
        runtime.projectId,
        runtime.taskId,
        queuedSubmissionId,
      );
      if (deleted) {
        await this.#attachmentStore.releaseQueue(runtime.projectId, queuedSubmissionId);
        this.#publishChanged(runtime);
      }
      return deleted;
    });
  }

  public async list(runtime: QueueRuntime): Promise<readonly AgentQueuedSubmission[]> {
    const records = await this.#repository.listQueue(runtime.projectId, runtime.taskId);
    return Promise.all(records.map((record) => this.#mapRecord(record)));
  }

  public async reorder(
    runtime: QueueRuntime,
    queuedSubmissionIds: readonly string[],
  ): Promise<void> {
    await this.#withTaskLock(runtime, async () => {
      await this.#repository.reorderQueue(runtime.projectId, runtime.taskId, queuedSubmissionIds);
      this.#publishChanged(runtime);
    });
  }

  public async start(runtime: QueueRuntime, queuedSubmissionId?: string): Promise<AgentTurn> {
    const turn = await this.#withTaskLock(runtime, () =>
      this.#startUnlocked(runtime, queuedSubmissionId),
    );
    if (turn === undefined) {
      throw new TaskQueueItemNotFoundError();
    }
    return turn;
  }

  public async startNext(runtime: QueueRuntime): Promise<void> {
    await this.#withTaskLock(runtime, async () => {
      const [first] = await this.#repository.listQueue(runtime.projectId, runtime.taskId);
      if (first?.status !== "queued") return;
      await this.#startUnlocked(runtime, first.id);
    });
  }

  public async update(
    runtime: QueueRuntime,
    queuedSubmissionId: string,
    input: AgentPromptInput,
    status: AgentQueuedSubmissionStatus,
  ): Promise<AgentQueuedSubmission> {
    return this.#withTaskLock(runtime, async () => {
      const { attachmentIds } = await this.#resolveProviderInput(
        runtime.projectId,
        input,
        runtime.provider,
        runtime.taskId,
      );
      const storedInput = { ...input, attachments: attachmentIds.map((id) => ({ id })) };
      const record = await this.#repository.updateQueue(
        runtime.projectId,
        runtime.taskId,
        queuedSubmissionId,
        storedInput,
        status,
      );
      if (record === undefined) throw new TaskQueueItemNotFoundError();
      await this.#attachmentStore.retainQueue(
        runtime.projectId,
        attachmentIds,
        queuedSubmissionId,
        true,
      );
      this.#publishChanged(runtime);
      return this.#mapRecord(record);
    });
  }

  async #mapRecord(record: AgentQueueRecord): Promise<AgentQueuedSubmission> {
    const attachments = await Promise.all(
      record.input.attachments.map(
        async ({ id }) => (await this.#attachmentStore.read(record.projectId, id)).attachment,
      ),
    );
    return {
      attachments,
      clientUserMessageId: record.clientUserMessageId,
      id: record.id,
      skills: record.input.skills,
      status: record.status,
      text: record.input.text,
    };
  }

  #publishChanged(runtime: QueueRuntime): void {
    runtime.eventStream.publish({ payload: {}, taskId: runtime.taskId, type: "queue.changed" });
  }

  async #startUnlocked(
    runtime: QueueRuntime,
    queuedSubmissionId?: string,
  ): Promise<AgentTurn | undefined> {
    const records = await this.#repository.listQueue(runtime.projectId, runtime.taskId);
    const selectedIndex =
      queuedSubmissionId === undefined
        ? 0
        : records.findIndex((record) => record.id === queuedSubmissionId);
    if (selectedIndex < 0) return undefined;
    const editingIndex = records.findIndex((record) => record.status === "editing");
    if (editingIndex >= 0 && selectedIndex >= editingIndex) throw new TaskQueueBlockedError();
    const selected = records[selectedIndex];
    if (selected?.status !== "queued") throw new TaskQueueBlockedError();
    const task = await runtime.provider.readTask(runtime.taskId);
    if (task?.turns.some((turn) => turn.status === "running") === true) {
      throw new TaskQueueBlockedError();
    }
    const { providerInput } = await this.#resolveProviderInput(
      runtime.projectId,
      selected.input,
      runtime.provider,
      runtime.taskId,
    );
    const settings = await this.#readTaskSettings(runtime.projectId, runtime.taskId);
    const turn = await runtime.provider.startTurn(runtime.taskId, providerInput, settings);
    await this.#repository.deleteQueue(runtime.projectId, runtime.taskId, selected.id);
    await this.#attachmentStore.startQueue(runtime.projectId, selected.id, turn.id);
    this.#publishChanged(runtime);
    return turn;
  }

  async #withTaskLock<T>(runtime: QueueRuntime, action: () => Promise<T>): Promise<T> {
    const key = `${runtime.projectId}\u0000${runtime.taskId}`;
    const previous = this.#locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.#locks.set(key, tail);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.#locks.get(key) === tail) this.#locks.delete(key);
    }
  }
}
