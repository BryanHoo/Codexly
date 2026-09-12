import { randomUUID } from "node:crypto";
import type {
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskRun,
  ScheduledTaskSchedule,
} from "@codexly/protocol";
import { previewScheduledTask, RecurrenceWorkerBusyError } from "./scheduled-task-recurrence.js";
export { previewScheduledTask } from "./scheduled-task-recurrence.js";

export const MAX_SCHEDULED_TASK_RUNS = 20;

export type ScheduledTaskClaim = Readonly<{
  runId: string;
  task: ScheduledTask;
}>;

export async function resolveNextScheduledRun(
  schedule: ScheduledTaskSchedule,
  afterUnixMs: number,
): Promise<number> {
  if (schedule.type === "once") {
    if (schedule.atUnixMs <= afterUnixMs)
      throw new Error("Scheduled task time must be in the future");
    return schedule.atUnixMs;
  }
  const next = (await previewScheduledTask(schedule, afterUnixMs, 1))[0];
  if (next === undefined) throw new Error("Scheduled task RRULE has no future occurrence");
  return next;
}

export async function createScheduledTask(
  id: string,
  input: ScheduledTaskInput,
  nowUnixMs: number,
): Promise<ScheduledTask> {
  const name = input.name.trim();
  if (name === "") throw new Error("Scheduled task name must not be empty");
  return {
    ...input,
    createdAtUnixMs: nowUnixMs,
    id,
    lastRunAtUnixMs: null,
    lastRunStatus: null,
    name,
    nextRunAtUnixMs: input.enabled
      ? await resolveNextScheduledRun(input.schedule, nowUnixMs)
      : null,
    runs: [],
    updatedAtUnixMs: nowUnixMs,
  };
}

function appendRun(task: ScheduledTask, run: ScheduledTaskRun): ScheduledTask["runs"] {
  return [...task.runs, run].slice(-MAX_SCHEDULED_TASK_RUNS);
}

async function advanceSchedule(
  task: ScheduledTask,
  nowUnixMs: number,
): Promise<Pick<ScheduledTask, "enabled" | "nextRunAtUnixMs">> {
  if (task.schedule.type === "once") return { enabled: false, nextRunAtUnixMs: null };
  try {
    return {
      enabled: true,
      nextRunAtUnixMs: await resolveNextScheduledRun(task.schedule, nowUnixMs),
    };
  } catch (error) {
    // 并发暂满交给服务的重试机制，不能把正常计划永久禁用。
    if (error instanceof RecurrenceWorkerBusyError) throw error;
    return { enabled: false, nextRunAtUnixMs: null };
  }
}

export async function claimScheduledTasks(
  source: readonly ScheduledTask[],
  running: ReadonlySet<string>,
  nowUnixMs: number,
  manualId?: string,
): Promise<Readonly<{ claims: readonly ScheduledTaskClaim[]; tasks: readonly ScheduledTask[] }>> {
  const claims: ScheduledTaskClaim[] = [];
  const tasks: ScheduledTask[] = [];
  // 串行推进任务，避免一批到期任务瞬间耗尽 Worker 并发名额。
  for (const task of source) tasks.push(await claim(task));
  return { claims, tasks };
  async function claim(task: ScheduledTask): Promise<ScheduledTask> {
    const selected =
      manualId === undefined
        ? task.enabled && task.nextRunAtUnixMs !== null && task.nextRunAtUnixMs <= nowUnixMs
        : task.id === manualId;
    if (!selected) return task;
    if (running.has(task.id)) {
      if (manualId !== undefined) return task;
      const run: ScheduledTaskRun = {
        error: "previous scheduled launch is still running",
        finishedAtUnixMs: nowUnixMs,
        id: randomUUID(),
        startedAtUnixMs: nowUnixMs,
        status: "skipped",
        taskId: null,
      };
      return {
        ...task,
        ...(await advanceSchedule(task, nowUnixMs)),
        lastRunAtUnixMs: nowUnixMs,
        lastRunStatus: "skipped" as const,
        runs: appendRun(task, run),
        updatedAtUnixMs: nowUnixMs,
      };
    }
    const runId = randomUUID();
    const claimed: ScheduledTask = {
      ...task,
      ...(manualId === undefined ? await advanceSchedule(task, nowUnixMs) : {}),
      lastRunAtUnixMs: nowUnixMs,
      lastRunStatus: "running",
      runs: appendRun(task, {
        error: null,
        finishedAtUnixMs: null,
        id: runId,
        startedAtUnixMs: nowUnixMs,
        status: "running",
        taskId: null,
      }),
      updatedAtUnixMs: nowUnixMs,
    };
    claims.push({ runId, task: claimed });
    return claimed;
  }
}

export function completeScheduledTaskRun(
  source: readonly ScheduledTask[],
  claim: ScheduledTaskClaim,
  finishedAtUnixMs: number,
  result: PromiseSettledResult<string>,
): readonly ScheduledTask[] {
  return source.map((task) => {
    if (task.id !== claim.task.id) return task;
    const status = result.status === "fulfilled" ? "started" : "failed";
    return {
      ...task,
      lastRunStatus: status,
      runs: task.runs.map((run) =>
        run.id === claim.runId
          ? {
              ...run,
              error: result.status === "rejected" ? String(result.reason) : null,
              finishedAtUnixMs,
              status,
              taskId: result.status === "fulfilled" ? result.value : null,
            }
          : run,
      ),
      updatedAtUnixMs: finishedAtUnixMs,
    };
  });
}

export function repairInterruptedScheduledTasks(
  source: readonly ScheduledTask[],
  nowUnixMs: number,
): readonly ScheduledTask[] {
  return source.map((task) => {
    if (!task.runs.some((run) => run.status === "running")) return task;
    return {
      ...task,
      lastRunStatus: "failed",
      runs: task.runs.map((run) =>
        run.status === "running"
          ? {
              ...run,
              error: "server exited before launch was confirmed",
              finishedAtUnixMs: nowUnixMs,
              status: "failed" as const,
            }
          : run,
      ),
      updatedAtUnixMs: nowUnixMs,
    };
  });
}
