import { RetainedWorkBudget } from "@codexly/core";

// 所有 Project Provider 共用进程预算，不能通过创建更多 Provider 绕过上限。
const notificationBudget = new RetainedWorkBudget({
  maxCount: 2048,
  maxBytes: 80 * 1024 * 1024,
  maxTaskCount: 256,
  maxTaskBytes: 32 * 1024 * 1024,
});
interface Entry {
  receive: (signal: AbortSignal) => void | Promise<void>;
  onError: () => void;
  controller: AbortController;
  release: () => void;
  started?: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

export class TaskNotificationQueue {
  readonly #pending = new Map<string, Entry[]>();
  #disposed = false;
  readonly #recovering = new Set<string>();

  public constructor(
    private readonly budget = notificationBudget,
    private readonly timeoutMs = 30_000,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
      throw new RangeError("Invalid notification deadline");
  }

  public run(taskId: string, receive: Entry["receive"], onError: () => void, bytes = 256): void {
    if (this.#disposed) return;
    let release = this.budget.reserve(taskId, bytes);
    if (release === undefined) {
      // 不能丢弃终态或越过队首：先让该任务全部已接收事件以无附件投影同步交付，再接收新事件。
      this.#recover(taskId);
      release = this.budget.reserve(taskId, bytes);
    }
    const entry: Entry = {
      receive,
      onError,
      controller: new AbortController(),
      release: release ?? (() => undefined),
    };
    if (release === undefined) {
      entry.controller.abort(new Error("Notification queue budget exceeded"));
      this.#invokeCanceled(entry);
      return;
    }
    const queue = this.#pending.get(taskId) ?? [];
    queue.push(entry);
    this.#pending.set(taskId, queue);
    // 截止时间从准入开始，排队不会重置计时器。
    const deadline = Date.now() + this.timeoutMs;
    if (queue.length === 1 && !this.#recovering.has(taskId)) this.#start(taskId, entry);
    // 普通 delta 同步交付后不创建定时器，避免给高频流增加无用的调度开销。
    if (this.#pending.get(taskId) === queue && queue.includes(entry)) {
      entry.timer = setTimeout(
        () => {
          this.#recover(taskId);
        },
        Math.max(0, deadline - Date.now()),
      );
      entry.timer.unref();
    }
  }

  public clearTask(taskId: string): void {
    const queue = this.#pending.get(taskId);
    this.#pending.delete(taskId);
    for (const entry of queue ?? []) {
      // 清理取消不交付占位事件；接收方通过 reason 区别清理和预算恢复。
      entry.controller.abort(new NotificationQueueClearedError());
      clearTimeout(entry.timer);
      entry.release();
    }
  }

  public dispose(): void {
    this.#disposed = true;
    for (const taskId of this.#pending.keys()) this.clearTask(taskId);
  }

  #invoke(entry: Entry): void | Promise<void> {
    try {
      return entry.receive(entry.controller.signal);
    } catch {
      entry.onError();
    }
  }

  #invokeCanceled(entry: Entry): void {
    const result = this.#invoke(entry);
    if (result instanceof Promise) void result.catch(entry.onError);
  }

  #start(taskId: string, entry: Entry): void {
    entry.started = true;
    const result = this.#invoke(entry);
    if (result instanceof Promise) {
      void result.then(
        () => {
          this.#finish(taskId, entry);
        },
        () => {
          if (!entry.controller.signal.aborted) entry.onError();
          this.#finish(taskId, entry);
        },
      );
    } else this.#finish(taskId, entry);
  }

  #finish(taskId: string, entry: Entry): void {
    const queue = this.#pending.get(taskId);
    if (queue?.[0] !== entry) return;
    clearTimeout(entry.timer);
    entry.release();
    queue.shift();
    if (queue.length === 0) this.#pending.delete(taskId);
    else {
      const next = queue[0];
      this.#start(taskId, next);
    }
  }

  #recover(taskId: string): void {
    const queue = this.#pending.get(taskId);
    if (queue === undefined) return;
    const alreadyRecovering = this.#recovering.has(taskId);
    this.#recovering.add(taskId);
    try {
      while (this.#pending.get(taskId) === queue && queue.length > 0) {
        const entry = queue.shift();
        if (entry === undefined) break;
        clearTimeout(entry.timer);
        entry.release();
        entry.controller.abort(new Error("Notification attachment deadline or budget exceeded"));
        // 队首已执行：abort 监听同步发布占位结果；其他事件使用预取消 signal 同步执行。
        // 保留队列身份，使交付期间重入的新通知继续排在原有事件后；任务清理会中止恢复。
        if (!entry.started) this.#invokeCanceled(entry);
      }
      if (this.#pending.get(taskId) === queue && queue.length === 0) this.#pending.delete(taskId);
    } finally {
      if (!alreadyRecovering) this.#recovering.delete(taskId);
    }
  }
}

export class NotificationQueueClearedError extends Error {}
