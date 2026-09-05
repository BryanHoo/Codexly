import { randomUUID } from "node:crypto";
import type { ScheduledTaskRepository } from "@codexly/core";
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
  deleteTaskResources?: (taskId: string) => Promise<void>;
  now?: () => number;
  persistTaskResources?: (task: ScheduledTask) => Promise<void>;
  repository: ScheduledTaskRepository;
  startTask: (task: ScheduledTask) => Promise<string>;
}>;

export class ScheduledTaskService {
  readonly #inFlight = new Set<Promise<void>>();
  readonly #deleteTaskResources: ((taskId: string) => Promise<void>) | undefined;
  readonly #now: () => number;
  readonly #repository: ScheduledTaskRepository;
  readonly #persistTaskResources: ((task: ScheduledTask) => Promise<void>) | undefined;
  readonly #running = new Set<string>();
  readonly #startTask: (task: ScheduledTask) => Promise<string>;
  #closed = false;
  #mutation: Promise<void> = Promise.resolve();
  #tasks: readonly ScheduledTask[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;

  public constructor(options: ScheduledTaskServiceOptions) {
    this.#deleteTaskResources = options.deleteTaskResources;
    this.#now = options.now ?? Date.now;
    this.#repository = options.repository;
    this.#persistTaskResources = options.persistTaskResources;
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

  public create(input: ScheduledTaskInput): Promise<ScheduledTask> {
    return this.#mutate(async () => {
      let task: ScheduledTask;
      try {
        task = createScheduledTask(randomUUID(), input, this.#now());
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
          ...createScheduledTask(id, input, this.#now()),
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
      await this.#deleteTaskResources?.(id);
    });
  }

  public setEnabled(id: string, enabled: boolean): Promise<ScheduledTask> {
    return this.#mutate(async () => {
      const existing = this.#find(id);
      let nextRunAtUnixMs = existing.nextRunAtUnixMs;
      if (enabled) {
        try {
          nextRunAtUnixMs = resolveNextScheduledRun(existing.schedule, this.#now());
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
      const result = claimScheduledTasks(this.#tasks, this.#running, this.#now(), id);
      const claim = result.claims[0];
      if (claim === undefined) {
        throw new ScheduledTaskServiceError("busy", "Scheduled task is already running");
      }
      this.#running.add(id);
      await this.#replace(result.tasks);
      this.#launch(claim);
      return claim.task;
    });
  }

  public async close(): Promise<void> {
    this.#closed = true;
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
    const launch = this.#startTask(claim.task)
      .then((value) => ({ status: "fulfilled" as const, value }))
      .catch((reason: unknown) => ({ reason, status: "rejected" as const }))
      .then((result) =>
        this.#mutate(async () => {
          this.#running.delete(claim.task.id);
          await this.#replace(completeScheduledTaskRun(this.#tasks, claim, this.#now(), result));
        }),
      )
      .finally(() => this.#inFlight.delete(launch));
    this.#inFlight.add(launch);
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
    this.#timer = setTimeout(() => void this.#tick(), Math.min(delay, 2_147_483_647));
    this.#timer.unref();
  }

  async #tick(): Promise<void> {
    await this.#mutate(async () => {
      const result = claimScheduledTasks(this.#tasks, this.#running, this.#now());
      for (const claim of result.claims) this.#running.add(claim.task.id);
      await this.#replace(result.tasks);
      for (const claim of result.claims) this.#launch(claim);
    });
  }

  async #replace(tasks: readonly ScheduledTask[]): Promise<void> {
    this.#tasks = await this.#repository.replaceScheduledTasks(tasks);
    this.#reschedule();
  }

  async #storeTask(tasks: readonly ScheduledTask[], task: ScheduledTask): Promise<void> {
    const previous = this.#tasks;
    await this.#replace(tasks);
    try {
      await this.#persistTaskResources?.(task);
    } catch (error) {
      await this.#replace(previous);
      throw new ScheduledTaskServiceError("invalid", String(error));
    }
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
