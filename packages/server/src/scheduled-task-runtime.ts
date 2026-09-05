import { randomUUID } from "node:crypto";
import type {
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskRun,
  ScheduledTaskSchedule,
} from "@codexly/protocol";
import { rrulestr } from "rrule";

export const MAX_SCHEDULED_TASK_RUNS = 20;
const MIN_RECURRENCE_MS = 60_000;

export type ScheduledTaskClaim = Readonly<{
  runId: string;
  task: ScheduledTask;
}>;

function rruleDateTime(unixMs: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: timezone,
    year: "numeric",
  })
    .formatToParts(unixMs)
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
  const requiredPart = (name: string): string => {
    const value = parts[name];
    if (value === undefined) throw new Error(`Scheduled task timezone part ${name} is unavailable`);
    return value;
  };
  return `${requiredPart("year")}${requiredPart("month")}${requiredPart("day")}T${requiredPart("hour")}${requiredPart("minute")}${requiredPart("second")}`;
}

export function resolveNextScheduledRun(
  schedule: ScheduledTaskSchedule,
  afterUnixMs: number,
): number {
  if (schedule.type === "once") {
    if (schedule.atUnixMs <= afterUnixMs)
      throw new Error("Scheduled task time must be in the future");
    return schedule.atUnixMs;
  }
  const normalized = schedule.rrule.trim().replace(/^RRULE:/u, "");
  if (normalized === "" || /[\r\n]/u.test(normalized)) {
    throw new Error("Scheduled task RRULE is invalid");
  }
  const rule = rrulestr(
    `DTSTART;TZID=${schedule.timezone}:${rruleDateTime(schedule.startAtUnixMs, schedule.timezone)}\nRRULE:${normalized}`,
    { forceset: true },
  );
  const first = rule.all((_date, index) => index < 2);
  if (
    first[0] !== undefined &&
    first[1] !== undefined &&
    first[1].getTime() - first[0].getTime() < MIN_RECURRENCE_MS
  ) {
    throw new Error("Scheduled task recurrence must be at least one minute");
  }
  const next = rule.after(new Date(afterUnixMs), false);
  if (next === null) throw new Error("Scheduled task RRULE has no future occurrence");
  return next.getTime();
}

export function createScheduledTask(
  id: string,
  input: ScheduledTaskInput,
  nowUnixMs: number,
): ScheduledTask {
  const name = input.name.trim();
  if (name === "") throw new Error("Scheduled task name must not be empty");
  return {
    ...input,
    createdAtUnixMs: nowUnixMs,
    id,
    lastRunAtUnixMs: null,
    lastRunStatus: null,
    name,
    nextRunAtUnixMs: input.enabled ? resolveNextScheduledRun(input.schedule, nowUnixMs) : null,
    runs: [],
    updatedAtUnixMs: nowUnixMs,
  };
}

function appendRun(task: ScheduledTask, run: ScheduledTaskRun): ScheduledTask["runs"] {
  return [...task.runs, run].slice(-MAX_SCHEDULED_TASK_RUNS);
}

function advanceSchedule(
  task: ScheduledTask,
  nowUnixMs: number,
): Pick<ScheduledTask, "enabled" | "nextRunAtUnixMs"> {
  if (task.schedule.type === "once") return { enabled: false, nextRunAtUnixMs: null };
  try {
    return { enabled: true, nextRunAtUnixMs: resolveNextScheduledRun(task.schedule, nowUnixMs) };
  } catch {
    return { enabled: false, nextRunAtUnixMs: null };
  }
}

export function claimScheduledTasks(
  source: readonly ScheduledTask[],
  running: ReadonlySet<string>,
  nowUnixMs: number,
  manualId?: string,
): Readonly<{ claims: readonly ScheduledTaskClaim[]; tasks: readonly ScheduledTask[] }> {
  const claims: ScheduledTaskClaim[] = [];
  const tasks = source.map((task) => {
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
        ...advanceSchedule(task, nowUnixMs),
        lastRunAtUnixMs: nowUnixMs,
        lastRunStatus: "skipped" as const,
        runs: appendRun(task, run),
        updatedAtUnixMs: nowUnixMs,
      };
    }
    const runId = randomUUID();
    const claimed: ScheduledTask = {
      ...task,
      ...(manualId === undefined ? advanceSchedule(task, nowUnixMs) : {}),
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
  });
  return { claims, tasks };
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
