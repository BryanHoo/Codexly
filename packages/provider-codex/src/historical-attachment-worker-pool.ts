import { availableParallelism } from "node:os";
import { setTimeout as scheduleIdleTimeout } from "node:timers";
import { Worker } from "node:worker_threads";

import type { AgentAttachmentKind } from "@codexly/protocol";

export type AttachmentWorkerJob = Readonly<{
  operation: "persist" | "read";
  source: Readonly<{ type: "file" | "base64" | "text"; path?: string; value?: string }>;
  directory?: string;
  digest?: string;
  kind: AgentAttachmentKind;
  maxBytes: number;
  mediaType?: string;
  size?: number;
}>;
export type AttachmentWorkerResult = Readonly<{
  blobKey: string;
  content?: ArrayBuffer;
  mediaType: string;
  path?: string;
  size: number;
}>;
type Request = Readonly<{
  job: AttachmentWorkerJob;
  resolve: (result: AttachmentWorkerResult) => void;
  reject: (error: Error) => void;
}>;
interface Slot {
  worker: Worker;
  request?: Request;
  idleTimer?: ReturnType<typeof setTimeout>;
}

export class InvalidHistoricalAttachmentError extends Error {}

export class HistoricalAttachmentWorkerPool {
  readonly #slots = new Set<Slot>();
  readonly #queue: Request[] = [];
  #disposed = false;

  public constructor(
    private readonly concurrency = Math.min(2, Math.max(1, availableParallelism() - 1)),
    private readonly workerUrl = new URL("./historical-attachment-worker.js", import.meta.url),
  ) {
    if (!Number.isSafeInteger(concurrency) || concurrency <= 0)
      throw new RangeError("Invalid attachment worker budget");
  }

  public run(job: AttachmentWorkerJob): Promise<AttachmentWorkerResult> {
    if (this.#disposed) return Promise.reject(new Error("Attachment worker pool is closed"));
    // 预算在进程内共享，排队仅保存原始引用；直到获得空闲线程才克隆有界字符串。
    // 不因瞬时批量历史读取丢弃附件，实际读盘、哈希和写盘始终受并发上限约束。
    return new Promise((resolve, reject) => {
      this.#queue.push({ job, resolve, reject });
      this.#dispatch();
    });
  }

  public dispose(): void {
    this.#disposed = true;
    const error = new Error("Attachment worker pool is closed");
    for (const request of this.#queue.splice(0)) request.reject(error);
    for (const slot of this.#slots) {
      clearTimeout(slot.idleTimer);
      slot.request?.reject(error);
      void slot.worker.terminate();
    }
    this.#slots.clear();
  }

  #dispatch(): void {
    while (this.#queue.length > 0) {
      let slot = [...this.#slots].find((candidate) => candidate.request === undefined);
      if (slot === undefined) {
        if (this.#slots.size >= this.concurrency) return;
        try {
          slot = this.#createSlot();
        } catch (error) {
          this.#queue.shift()?.reject(error instanceof Error ? error : new Error(String(error)));
          continue;
        }
      }
      clearTimeout(slot.idleTimer);
      const request = this.#queue.shift();
      if (request === undefined) return;
      slot.request = request;
      slot.worker.ref();
      try {
        slot.worker.postMessage(slot.request.job);
      } catch (error) {
        this.#fail(slot, error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  #createSlot(): Slot {
    const slot: Slot = { worker: new Worker(this.workerUrl) };
    this.#slots.add(slot);
    slot.worker.on(
      "message",
      (response: { result?: AttachmentWorkerResult; error?: string; invalid?: boolean }) => {
        const request = slot.request;
        delete slot.request;
        if (response.result !== undefined) request?.resolve(response.result);
        else
          request?.reject(
            response.invalid === true
              ? new InvalidHistoricalAttachmentError(response.error)
              : new Error(response.error ?? "Invalid attachment worker response"),
          );
        slot.worker.unref();
        // 保留短暂热池降低连续附件的启动成本，空闲后自动释放线程和内存。
        slot.idleTimer = scheduleIdleTimeout(() => {
          this.#slots.delete(slot);
          void slot.worker.terminate();
        }, 30_000);
        slot.idleTimer.unref();
        this.#dispatch();
      },
    );
    slot.worker.once("error", (error: Error) => {
      this.#fail(slot, error);
    });
    slot.worker.once("exit", (code) => {
      this.#fail(slot, new Error(`Attachment worker exited: ${String(code)}`));
    });
    return slot;
  }

  #fail(slot: Slot, error: Error): void {
    if (!this.#slots.delete(slot)) return;
    clearTimeout(slot.idleTimer);
    slot.request?.reject(error);
    void slot.worker.terminate();
    this.#dispatch();
  }
}

export const historicalAttachmentWorkers = new HistoricalAttachmentWorkerPool();
