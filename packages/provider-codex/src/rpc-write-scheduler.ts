import type { Writable } from "node:stream";

import {
  RpcConnectionClosedError,
  RpcTimeoutError,
  RpcWriteQueueFullError,
} from "./jsonl-rpc-errors.js";
import { createRpcAbortError } from "./rpc-cancellation.js";
import { validatePositiveSafeInteger } from "./rpc-overload-retry.js";

interface WriteEntry {
  readonly bytes: number;
  readonly deadline: number;
  readonly key: number | undefined;
  readonly reject: (error: Error) => void;
  readonly resolve: () => void;
  readonly timeoutError: Error;
  timer: NodeJS.Timeout | undefined;
  delivered: boolean;
  settled: boolean;
}

interface RpcWriteSchedulerOptions {
  readonly output: Writable;
  readonly maxBytes: number | undefined;
  readonly maxMessages: number | undefined;
  readonly onFailure: (error: Error) => void;
  readonly defaultTimeoutMs: number;
}

/** stdin 的唯一写入者；预算同时覆盖待交付帧和写回调尚未完成的帧。 */
export class RpcWriteScheduler {
  readonly #options: RpcWriteSchedulerOptions;
  readonly #maxBytes: number;
  readonly #maxMessages: number;
  readonly #entries = new Set<WriteEntry>();
  readonly #queue = new Map<WriteEntry, Buffer>();
  #bytes = 0;
  #activeBytes = 0;
  #encodingCount = 0;
  #blocked = false;
  #drainDeadline = Infinity;
  #closed = false;
  #flushing = false;
  #stallTimer: NodeJS.Timeout | undefined;

  public constructor(options: RpcWriteSchedulerOptions) {
    this.#options = options;
    // 80 MiB 容纳 50 MiB 图片经 Base64 编码后的单帧；数量限制单独约束大量小请求。
    this.#maxBytes = validatePositiveSafeInteger(
      options.maxBytes ?? 80 * 1024 * 1024,
      "maxWriteBufferBytes",
    );
    this.#maxMessages = validatePositiveSafeInteger(options.maxMessages ?? 128, "maxPendingWrites");
    options.output.on("drain", this.#handleDrain);
  }

  public send(
    message: unknown,
    deadline = Date.now() + this.#options.defaultTimeoutMs,
    timeoutError: Error = new RpcConnectionClosedError(
      `RPC write timed out after ${String(this.#options.defaultTimeoutMs)}ms`,
    ),
    key?: number,
    isCurrent?: () => boolean,
  ): Promise<void> {
    let write: Promise<void>;
    try {
      write = this.#enqueue(message, deadline, timeoutError, key, isCurrent);
    } catch (error) {
      write = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return write.catch((error: unknown) => {
      // 本地准入、取消和请求截止只影响当前请求，不能连带关闭其他会话。
      if (
        error instanceof RpcWriteQueueFullError ||
        error instanceof RpcTimeoutError ||
        (error instanceof Error && error.name === "AbortError")
      )
        throw error;
      const failure =
        error instanceof RpcConnectionClosedError
          ? error
          : new RpcConnectionClosedError(
              `RPC write failed: ${error instanceof Error ? error.message : String(error)}`,
            );
      this.#fail(failure);
      throw failure;
    });
  }

  #enqueue(
    message: unknown,
    deadline: number,
    timeoutError: Error,
    key: number | undefined,
    isCurrent: (() => boolean) | undefined,
  ): Promise<void> {
    if (this.#isClosed()) return Promise.reject(new RpcConnectionClosedError());
    // 先限制数量，避免满载时仍为每个调用分配序列化字符串；保留同步编码的槽位以防 toJSON 重入。
    if (this.#entries.size + this.#encodingCount >= this.#maxMessages) {
      return Promise.reject(new RpcWriteQueueFullError("RPC outbound message limit exceeded"));
    }
    if (Date.now() >= deadline) return Promise.reject(timeoutError);
    this.#encodingCount += 1;
    let text: string;
    try {
      text = `${JSON.stringify(message)}\n`;
    } finally {
      this.#encodingCount -= 1;
    }
    // JSON.stringify 是同步操作，必须在编码后再次核对绝对截止时间，不能依赖事件循环计时器。
    if (this.#closed) return Promise.reject(new RpcConnectionClosedError());
    if (isCurrent?.() === false) return Promise.reject(createRpcAbortError());
    if (Date.now() >= deadline) return Promise.reject(timeoutError);
    const bytes = Buffer.byteLength(text, "utf8");
    const bufferedBytes =
      this.#bytes + Math.max(0, this.#options.output.writableLength - this.#activeBytes);
    if (bytes > this.#maxBytes - bufferedBytes) {
      return Promise.reject(new RpcWriteQueueFullError());
    }
    const frame = Buffer.from(text, "utf8");
    return new Promise<void>((resolve, reject) => {
      const entry: WriteEntry = {
        bytes,
        deadline,
        key,
        reject,
        resolve,
        timeoutError,
        delivered: false,
        settled: false,
        timer: undefined,
      };
      entry.timer = setTimeout(
        () => {
          this.#cancelEntry(entry, timeoutError);
        },
        Math.max(0, deadline - Date.now()),
      );
      entry.timer.unref();
      this.#entries.add(entry);
      this.#queue.set(entry, frame);
      this.#bytes += bytes;
      this.#flush();
    });
  }

  public cancel(key: number, reason: Error): void {
    for (const entry of this.#entries) {
      if (entry.key === key) this.#cancelEntry(entry, reason);
    }
  }

  #isClosed(): boolean {
    return this.#closed;
  }

  public close(reason: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#options.output.off("drain", this.#handleDrain);
    clearTimeout(this.#stallTimer);
    for (const entry of this.#entries) this.#settle(entry, reason);
    this.#entries.clear();
    this.#queue.clear();
    this.#bytes = 0;
    this.#activeBytes = 0;
  }

  #cancelEntry(entry: WriteEntry, reason: Error): void {
    this.#settle(entry, reason);
    if (!entry.delivered) {
      this.#queue.delete(entry);
      this.#release(entry);
    }
    // 已交付帧无法从 Writable 撤回：保留其预算，直到写回调完成或连接关闭。
  }

  #settle(entry: WriteEntry, error?: Error): void {
    if (entry.settled) return;
    entry.settled = true;
    clearTimeout(entry.timer);
    if (error) entry.reject(error);
    else entry.resolve();
  }

  #release(entry: WriteEntry): void {
    if (!this.#entries.delete(entry)) return;
    this.#bytes -= entry.bytes;
    if (entry.delivered) this.#activeBytes -= entry.bytes;
  }

  readonly #handleDrain = (): void => {
    this.#blocked = false;
    this.#drainDeadline = Infinity;
    this.#refreshStallTimer();
    this.#flush();
  };

  #refreshStallTimer(): void {
    clearTimeout(this.#stallTimer);
    this.#stallTimer = undefined;
    // 即使请求已取消，已交付帧仍保留原截止时间，不能因默认超时或其他写入而缩短、延长。
    let deadline = this.#drainDeadline;
    for (const entry of this.#entries) {
      if (entry.delivered) deadline = Math.min(deadline, entry.deadline);
    }
    if (this.#closed || deadline === Infinity) return;
    this.#stallTimer = setTimeout(
      () => {
        this.#fail(
          new RpcConnectionClosedError(
            "RPC output stalled while waiting for write completion or drain",
          ),
        );
      },
      Math.max(0, deadline - Date.now()),
    );
    this.#stallTimer.unref();
  }

  #fail(error: Error): void {
    if (this.#closed) return;
    this.close(error);
    // Writable 可能在写回调之后触发 error，延后客户端清理，确保该事件仍有监听者。
    queueMicrotask(() => {
      this.#options.onFailure(error);
    });
  }

  #flush(): void {
    if (this.#isClosed() || this.#blocked || this.#flushing) return;
    this.#flushing = true;
    try {
      for (const [entry, frame] of this.#queue) {
        if (this.#closed || this.#blocked) break;
        if (Date.now() >= entry.deadline) {
          this.#cancelEntry(entry, entry.timeoutError);
          continue;
        }
        this.#queue.delete(entry);
        entry.delivered = true;
        this.#activeBytes += entry.bytes;
        const accepted = this.#options.output.write(frame, (error) => {
          if (this.#closed) return;
          this.#release(entry);
          if (error) {
            const failure = new RpcConnectionClosedError(`RPC write failed: ${error.message}`);
            this.#settle(entry, failure);
            this.#fail(failure);
            return;
          }
          this.#settle(entry);
          this.#refreshStallTimer();
        });
        // write(false) 已接收当前帧，但下一帧必须等 drain；写回调成功不能解除这一屏障。
        if (!accepted) {
          this.#blocked = true;
          this.#drainDeadline = entry.deadline;
        }
        this.#refreshStallTimer();
      }
    } catch (error) {
      this.#fail(
        new RpcConnectionClosedError(
          `RPC write failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    } finally {
      this.#flushing = false;
    }
  }
}
