import { randomUUID } from "node:crypto";
import type { ScheduledTaskAttachmentReplacement, ScheduledTaskRepository } from "@codexly/core";
import type { ScheduledTask, ScheduledTaskInput } from "@codexly/protocol";

import {
  claimScheduledTasks,
  completeScheduledTaskRun,
  createScheduledTask,
  repairInterruptedScheduledTasks,
  resolveNextScheduledRun,
  type ScheduledTaskClaim,
} from "./scheduled-task-runtime.js";

export type ScheduledTaskServiceErrorCode = "busy" | "invalid" | "not_found";

export class ScheduledTaskServiceError extends Error {
  public constructor(
    public readonly code: ScheduledTaskServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ScheduledTaskServiceError";
  }
}

export function createMemoryScheduledTaskRepository(): ScheduledTaskRepository {
  let tasks: readonly ScheduledTask[] = [];
  return {
    listScheduledTasks: () => Promise.resolve(tasks),
    replaceScheduledTasks: (next) => {
      tasks = [...next];
      return Promise.resolve(tasks);
    },
  };
}

type ScheduledTaskServiceOptions = Readonly<{
  now?: () => number;
  prepareTaskResources?: (task: ScheduledTask) => Promise<ScheduledTaskAttachmentReplacement>;
  repository: ScheduledTaskRepository;
  startTask: (task: ScheduledTask) => Promise<string>;
}>;

export class ScheduledTaskService {
  readonly #listeners = new Set<() => void>();
  readonly #inFlight = new Set<Promise<void>>();
  readonly #now: () => number;
  readonly #repository: ScheduledTaskRepository;
  readonly #prepareTaskResources: ScheduledTaskServiceOptions["prepareTaskResources"];
  readonly #running = new Set<string>();
  readonly #completions = new Map<
    string,
    Readonly<{
      claim: ScheduledTaskClaim;
      finishedAtUnixMs: number;
      result: PromiseSettledResult<string>;
    }>
  >();
  readonly #startTask: (task: ScheduledTask) => Promise<string>;
  #closed = false;
  #mutation: Promise<void> = Promise.resolve();
  #tasks: readonly ScheduledTask[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;

  public constructor(options: ScheduledTaskServiceOptions) {
    this.#now = options.now ?? Date.now;
    this.#repository = options.repository;
    this.#prepareTaskResources = options.prepareTaskResources;
    this.#startTask = options.startTask;
  }

  public async start(): Promise<void> {
    await this.#mutate(async () => {
      const stored = await this.#repository.listScheduledTasks();
      const repaired = repairInterruptedScheduledTasks(stored, this.#now());
      this.#tasks = repaired;
      if (repaired.some((task, index) => task !== stored[index])) {
        await this.#repository.replaceScheduledTasks(repaired);
      }
      this.#reschedule();
    });
  }

  public list(): Promise<readonly ScheduledTask[]> {
    return this.#mutate(() =>
      [...this.#tasks].sort(
        (left, right) =>
          (left.nextRunAtUnixMs ?? Number.MAX_SAFE_INTEGER) -
            (right.nextRunAtUnixMs ?? Number.MAX_SAFE_INTEGER) ||
          left.createdAtUnixMs - right.createdAtUnixMs,
      ),
    );
  }

  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  public create(input: ScheduledTaskInput): Promise<ScheduledTask> {
    return this.#mutate(async () => {
      let task: ScheduledTask;
      try {
        task = await createScheduledTask(randomUUID(), input, this.#now());
      } catch (error) {
        throw new ScheduledTaskServiceError("invalid", String(error));
      }
      await this.#storeTask([...this.#tasks, task], task);
      return task;
    });
  }

  public update(id: string, input: ScheduledTaskInput): Promise<ScheduledTask> {
    return this.#mutate(async () => {
      const existing = this.#find(id);
      let task: ScheduledTask;
      try {
        task = {
          ...(await createScheduledTask(id, input, this.#now())),
          createdAtUnixMs: existing.createdAtUnixMs,
          lastRunAtUnixMs: existing.lastRunAtUnixMs,
          lastRunStatus: existing.lastRunStatus,
          runs: existing.runs,
        };
      } catch (error) {
        throw new ScheduledTaskServiceError("invalid", String(error));
      }
      await this.#storeTask(
        this.#tasks.map((item) => (item.id === id ? task : item)),
        task,
      );
      return task;
    });
  }

  public delete(id: string): Promise<void> {
    return this.#mutate(async () => {
      this.#find(id);
      if (this.#running.has(id)) {
        throw new ScheduledTaskServiceError("busy", "Scheduled task is running");
      }
      await this.#replace(this.#tasks.filter((task) => task.id !== id));
    });
  }

  public setEnabled(id: string, enabled: boolean): Promise<ScheduledTask> {
    return this.#mutate(async () => {
      const existing = this.#find(id);
      let nextRunAtUnixMs = existing.nextRunAtUnixMs;
      if (enabled) {
        try {
          nextRunAtUnixMs = await resolveNextScheduledRun(existing.schedule, this.#now());
        } catch (error) {
          throw new ScheduledTaskServiceError("invalid", String(error));
        }
      }
      const task = { ...existing, enabled, nextRunAtUnixMs, updatedAtUnixMs: this.#now() };
      await this.#replace(this.#tasks.map((item) => (item.id === id ? task : item)));
      return task;
    });
  }

  public runNow(id: string): Promise<ScheduledTask> {
    return this.#mutate(async () => {
      this.#find(id);
      const result = await claimScheduledTasks(this.#tasks, this.#running, this.#now(), id);
      const claim = result.claims[0];
      if (claim === undefined) {
        throw new ScheduledTaskServiceError("busy", "Scheduled task is already running");
      }
      await this.#replace(result.tasks);
      // mutation 已串行化；持久化成功后才占用运行锁，写入失败可直接重试。
      this.#running.add(id);
      this.#launch(claim);
      return claim.task;
    });
  }

  public async close(): Promise<void> {
    this.#closed = true;
    this.#listeners.clear();
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    await Promise.allSettled(this.#inFlight);
    await this.#mutation;
  }

  #find(id: string): ScheduledTask {
    const task = this.#tasks.find((item) => item.id === id);
    if (task === undefined)
      throw new ScheduledTaskServiceError("not_found", "Scheduled task not found");
    return task;
  }

  #launch(claim: ScheduledTaskClaim): void {
    const launch = Promise.resolve()
      .then(() => this.#startTask(claim.task))
      .then((value) => ({ status: "fulfilled" as const, value }))
      .catch((reason: unknown) => ({ reason, status: "rejected" as const }))
      .then((result) =>
        this.#mutate(async () => {
          // 保存已知启动结果，落库重试只提交结果，绝不重新启动任务。
          this.#completions.set(claim.task.id, { claim, finishedAtUnixMs: this.#now(), result });
          await this.#flushCompletions();
        }),
      )
      .catch(() => {
        this.#scheduleRetry();
      })
      .finally(() => this.#inFlight.delete(launch));
    this.#inFlight.add(launch);
  }

  async #flushCompletions(): Promise<void> {
    for (const [id, completion] of this.#completions) {
      await this.#replace(
        completeScheduledTaskRun(
          this.#tasks,
          completion.claim,
          completion.finishedAtUnixMs,
          completion.result,
        ),
      );
      this.#completions.delete(id);
      this.#running.delete(id);
    }
  }

  #scheduleRetry(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    if (this.#closed) return;
    // 存储故障采用有界间隔重试，避免到期任务在失败后形成毫秒级忙循环。
    this.#timer = setTimeout(
      () =>
        void this.#tick().catch(() => {
          this.#scheduleRetry();
        }),
      1_000,
    );
    this.#timer.unref();
  }

  #reschedule(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    if (this.#closed) return;
    const next = this.#tasks
      .filter((task) => task.enabled)
      .flatMap((task) => (task.nextRunAtUnixMs === null ? [] : [task.nextRunAtUnixMs]))
      .reduce<number | undefined>(
        (minimum, value) => (minimum === undefined ? value : Math.min(minimum, value)),
        undefined,
      );
    const delay = next === undefined ? 24 * 60 * 60 * 1_000 : Math.max(1, next - this.#now());
    this.#timer = setTimeout(
      () =>
        void this.#tick().catch(() => {
          this.#scheduleRetry();
        }),
      Math.min(delay, this.#completions.size > 0 ? 1_000 : 2_147_483_647),
    );
    this.#timer.unref();
  }

  async #tick(): Promise<void> {
    await this.#mutate(async () => {
      if (this.#closed) return;
      await this.#flushCompletions();
      const result = await claimScheduledTasks(this.#tasks, this.#running, this.#now());
      await this.#replace(result.tasks);
      for (const claim of result.claims) this.#running.add(claim.task.id);
      for (const claim of result.claims) this.#launch(claim);
    });
  }

  async #replace(
    tasks: readonly ScheduledTask[],
    attachments?: ScheduledTaskAttachmentReplacement,
  ): Promise<void> {
    // 空闲唤醒不写库、不推送；保持下次调度，变化落库后才通知浏览器。
    if (
      tasks.length === this.#tasks.length &&
      tasks.every((task, index) => task === this.#tasks[index])
    ) {
      this.#reschedule();
      return;
    }
    // 仓储事务成功后再更新内存、调度与订阅者；失败时保留原状态。
    this.#tasks = await this.#repository.replaceScheduledTasks(tasks, attachments);
    this.#reschedule();
    for (const listener of this.#listeners) listener();
  }

  async #storeTask(tasks: readonly ScheduledTask[], task: ScheduledTask): Promise<void> {
    let attachments: ScheduledTaskAttachmentReplacement | undefined;
    try {
      attachments = await this.#prepareTaskResources?.(task);
    } catch (error) {
      throw new ScheduledTaskServiceError("invalid", String(error));
    }
    await this.#replace(tasks, attachments);
  }

  #mutate<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.#mutation.then(operation);
    this.#mutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
