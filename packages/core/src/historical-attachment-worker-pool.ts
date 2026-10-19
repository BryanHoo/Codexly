import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { availableParallelism } from "node:os";
import { setTimeout as scheduleIdleTimeout } from "node:timers";
import { Worker } from "node:worker_threads";

import type { AgentAttachmentKind } from "@codexly/protocol";
import { estimateRetainedBytes, RetainedWorkBudget } from "./retained-work-budget.js";

// 独立桌面宿主将 Worker 编译进虚拟文件系统，构建时指定其入口；Node 分发沿用同目录文件。
declare const CODEXLY_COMPILED_ATTACHMENT_WORKER: string | undefined;

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
interface Request {
  job: AttachmentWorkerJob & { temporaryName?: string };
  taskKey: string;
  resolve: (result: AttachmentWorkerResult) => void;
  reject: (error: Error) => void;
  release: () => void;
  timer?: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abort?: () => void;
  settled?: boolean;
}
interface Slot {
  worker: Worker;
  request?: Request;
  idleTimer?: ReturnType<typeof setTimeout>;
  stopping?: boolean;
  termination?: Promise<void>;
}

export class InvalidHistoricalAttachmentError extends Error {}
export class AttachmentQueueFullError extends Error {
  public override name = "AttachmentQueueFullError";
}
export class AttachmentJobTimeoutError extends Error {
  public override name = "AttachmentJobTimeoutError";
}

const workerBudget = new RetainedWorkBudget({
  maxCount: 256,
  maxBytes: 128 * 1024 * 1024,
  maxTaskCount: 64,
  maxTaskBytes: 64 * 1024 * 1024,
});
interface RunOptions {
  taskKey?: string;
  signal?: AbortSignal;
}
interface PoolOptions {
  budget?: RetainedWorkBudget;
  timeoutMs?: number;
}

export class HistoricalAttachmentWorkerPool {
  readonly #slots = new Set<Slot>();
  readonly #queue: Request[] = [];
  #disposed = false;
  readonly #budget: RetainedWorkBudget;
  readonly #timeoutMs: number;

  public constructor(
    private readonly concurrency = Math.min(2, Math.max(1, availableParallelism() - 1)),
    private readonly workerUrl = new URL(
      typeof CODEXLY_COMPILED_ATTACHMENT_WORKER === "undefined"
        ? "./historical-attachment-worker.js"
        : CODEXLY_COMPILED_ATTACHMENT_WORKER,
      import.meta.url,
    ),
    options: PoolOptions = {},
  ) {
    if (!Number.isSafeInteger(concurrency) || concurrency <= 0)
      throw new RangeError("Invalid attachment worker budget");
    this.#budget = options.budget ?? workerBudget;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs <= 0)
      throw new RangeError("Invalid attachment worker deadline");
  }

  public run(job: AttachmentWorkerJob, options: RunOptions = {}): Promise<AttachmentWorkerResult> {
    if (this.#disposed) return Promise.reject(new Error("Attachment worker pool is closed"));
    if (options.signal?.aborted) return Promise.reject(this.#abortError());
    // 准入前估算保留的 UTF-16 正文和元数据，既不复制正文，也不把文件大小误算成排队内存。
    const bytes = estimateRetainedBytes(job, 128 * 1024 * 1024);
    const release = this.#budget.reserve(options.taskKey ?? job.directory ?? "unscoped", bytes);
    if (release === undefined)
      return Promise.reject(new AttachmentQueueFullError("Attachment queue budget exceeded"));
    return new Promise((resolve, reject) => {
      const request: Request = {
        job: job.operation === "persist" ? { ...job, temporaryName: `${randomUUID()}.tmp` } : job,
        taskKey: options.taskKey ?? job.directory ?? "unscoped",
        resolve,
        reject,
        release,
      };
      request.timer = setTimeout(() => {
        this.#cancel(request, new AttachmentJobTimeoutError("Attachment job deadline exceeded"));
      }, this.#timeoutMs);
      request.timer.unref();
      if (options.signal !== undefined) {
        request.signal = options.signal;
        request.abort = () => {
          this.#cancel(request, this.#abortError());
        };
        options.signal.addEventListener("abort", request.abort, { once: true });
      }
      this.#queue.push(request);
      this.#dispatch();
    });
  }

  public dispose(): Promise<void> {
    this.#disposed = true;
    const error = new Error("Attachment worker pool is closed");
    for (const request of this.#queue.splice(0)) this.#settle(request, error);
    for (const slot of this.#slots) this.#fail(slot, error);
    return Promise.all([...this.#slots].map((slot) => slot.termination ?? Promise.resolve())).then(
      () => undefined,
    );
  }

  /** 删除正文前等待真正退出；逻辑超时的快速拒绝不能充当磁盘写入已停止的屏障。 */
  public cancelTask(taskKey: string): Promise<void> {
    for (const request of [...this.#queue]) {
      if (request.taskKey === taskKey) this.#cancel(request, this.#abortError());
    }
    const slots = [...this.#slots].filter((slot) => slot.request?.taskKey === taskKey);
    for (const slot of slots) this.#fail(slot, this.#abortError());
    return Promise.all(slots.map((slot) => slot.termination ?? Promise.resolve())).then(
      () => undefined,
    );
  }

  #abortError(): Error {
    const error = new Error("Attachment job canceled");
    error.name = "AbortError";
    return error;
  }

  #settle(request: Request, error?: Error, result?: AttachmentWorkerResult): void {
    if (request.settled) return;
    request.settled = true;
    clearTimeout(request.timer);
    if (request.abort !== undefined) request.signal?.removeEventListener("abort", request.abort);
    request.release();
    if (error !== undefined) request.reject(error);
    else if (result !== undefined) request.resolve(result);
  }

  #cancel(request: Request, error: Error): void {
    const index = this.#queue.indexOf(request);
    if (index >= 0) {
      this.#queue.splice(index, 1);
      this.#settle(request, error);
      return;
    }
    const slot = [...this.#slots].find((candidate) => candidate.request === request);
    if (slot !== undefined) this.#fail(slot, error);
  }

  #dispatch(): void {
    while (!this.#disposed && this.#queue.length > 0) {
      let slot = [...this.#slots].find(
        (candidate) => candidate.request === undefined && !candidate.stopping,
      );
      if (slot === undefined) {
        if (this.#slots.size >= this.concurrency) return;
        try {
          slot = this.#createSlot();
        } catch (error) {
          const request = this.#queue.shift();
          if (request !== undefined)
            this.#settle(request, error instanceof Error ? error : new Error(String(error)));
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
        if (slot.stopping || !this.#slots.has(slot)) return;
        const request = slot.request;
        delete slot.request;
        if (request === undefined) return;
        if (response.result !== undefined) this.#settle(request, undefined, response.result);
        else
          this.#settle(
            request,
            response.invalid === true
              ? new InvalidHistoricalAttachmentError(response.error)
              : new Error(response.error ?? "Invalid attachment worker response"),
          );
        slot.worker.unref();
        // 保留短暂热池降低连续附件的启动成本，空闲后自动释放线程和内存。
        slot.idleTimer = scheduleIdleTimeout(() => {
          this.#fail(slot, new Error("Attachment worker idle"));
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
    if (!this.#slots.has(slot) || slot.stopping) return;
    slot.stopping = true;
    clearTimeout(slot.idleTimer);
    const request = slot.request;
    // 逻辑截止时间立即拒绝；退出中的线程仍占用槽位和预算，防止超时风暴创建无限线程。
    if (request !== undefined) {
      clearTimeout(request.timer);
      if (request.abort !== undefined) request.signal?.removeEventListener("abort", request.abort);
      request.reject(error);
    }
    slot.termination = slot.worker
      .terminate()
      .catch(() => undefined)
      .then(() => {
        this.#slots.delete(slot);
        delete slot.request;
        if (request !== undefined) {
          // terminate 不保证运行 Worker 的 finally；只清理本次专属暂存名，不触碰其他写入。
          if (request.job.temporaryName !== undefined && request.job.directory !== undefined) {
            void rm(join(request.job.directory, request.job.temporaryName), { force: true }).catch(
              () => undefined,
            );
          }
          this.#settle(request, error);
        }
        this.#dispatch();
      });
  }
}

export const historicalAttachmentWorkers = new HistoricalAttachmentWorkerPool();
