import type { CodexlyRuntimeClient } from "../../projects/project-queries.js";

const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;

interface RetryEntry {
  attempt: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export class TaskUnsubscribeRetryController {
  readonly #client: CodexlyRuntimeClient;
  readonly #entries = new Map<string, RetryEntry>();
  readonly #onError: (error: unknown, taskId: string) => void;
  readonly #projectId: string;
  #disposed = false;

  public constructor(
    projectId: string,
    client: CodexlyRuntimeClient,
    onError: (error: unknown, taskId: string) => void,
  ) {
    this.#client = client;
    this.#onError = onError;
    this.#projectId = projectId;
  }

  public cancel(taskId: string): void {
    const entry = this.#entries.get(taskId);
    if (entry?.timer !== undefined) {
      clearTimeout(entry.timer);
    }
    this.#entries.delete(taskId);
  }

  public dispose(): void {
    this.#disposed = true;
    for (const taskId of this.#entries.keys()) {
      this.cancel(taskId);
    }
  }

  public request(taskId: string): void {
    if (this.#disposed || this.#entries.has(taskId)) {
      return;
    }
    const entry: RetryEntry = { attempt: 0, timer: undefined };
    this.#entries.set(taskId, entry);
    void this.#attempt(taskId, entry);
  }

  async #attempt(taskId: string, entry: RetryEntry): Promise<void> {
    try {
      const response = await this.#client.unsubscribeTask(this.#projectId, taskId);
      if (this.#disposed || this.#entries.get(taskId) !== entry) {
        return;
      }
      if (response.status !== "busy") {
        this.#entries.delete(taskId);
        return;
      }

      // busy 表示本地生命周期尚未稳定，使用有上限退避持续等待下一次安全窗口。
      const delayMs = Math.min(INITIAL_RETRY_DELAY_MS * 2 ** entry.attempt, MAX_RETRY_DELAY_MS);
      entry.attempt += 1;
      entry.timer = setTimeout(() => {
        entry.timer = undefined;
        void this.#attempt(taskId, entry);
      }, delayMs);
    } catch (error) {
      if (this.#entries.get(taskId) === entry) {
        this.#entries.delete(taskId);
        this.#onError(error, taskId);
      }
    }
  }
}
