import { Worker } from "node:worker_threads";
import type { ScheduledTaskSchedule } from "@codexly/protocol";

const MAX_ACTIVE_WORKERS = 4;
const COMPUTATION_TIMEOUT_MS = 1_000;
let activeWorkers = 0;

export class RecurrenceWorkerBusyError extends Error {
  constructor() {
    super("Scheduled task recurrence workers are busy");
  }
}

function validateComplexity(rrule: string): void {
  // 在解析及构造日历候选集合之前限制输入，避免超长列表和秒级扫描。
  if (rrule.length > 1_024 || /[\r\n]/u.test(rrule))
    throw new Error("Scheduled task RRULE is too complex");
  const fields = rrule
    .trim()
    .replace(/^RRULE:/u, "")
    .split(";");
  const seen = new Set<string>();
  let combinations = 1;
  for (const field of fields) {
    const [key, value] = field.split("=");
    if (!key || !value || seen.has(key)) throw new Error("Scheduled task RRULE is invalid");
    seen.add(key);
    if (key === "FREQ" && value === "SECONDLY")
      throw new Error("Scheduled task recurrence must be at least one minute");
    if (key.startsWith("BY")) combinations *= value.split(",").length;
    if (combinations > 1_024) throw new Error("Scheduled task RRULE is too complex");
  }
}

export async function previewScheduledTask(
  schedule: ScheduledTaskSchedule,
  afterUnixMs: number,
  limit = 5,
): Promise<number[]> {
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error("Scheduled task preview limit is invalid");
  if (schedule.type === "once") return schedule.atUnixMs > afterUnixMs ? [schedule.atUnixMs] : [];
  validateComplexity(schedule.rrule);
  // 共享并发上限且不排队，避免并发预览耗尽线程和待处理请求内存。
  if (activeWorkers >= MAX_ACTIVE_WORKERS) throw new RecurrenceWorkerBusyError();
  activeWorkers += 1;
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    worker = new Worker(new URL("./scheduled-task-recurrence-worker.js", import.meta.url), {
      execArgv: ["--experimental-strip-types"],
      workerData: { schedule, afterUnixMs, limit: Math.min(limit, 5) },
      resourceLimits: { maxOldGenerationSizeMb: 32 },
    });
    const runningWorker = worker;
    return await new Promise<number[]>((resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error("Scheduled task RRULE computation timed out"));
      }, COMPUTATION_TIMEOUT_MS);
      runningWorker.once("message", (message: { dates: number[]; error?: string }) => {
        if (message.error !== undefined) reject(new Error(message.error));
        else resolve(message.dates);
      });
      runningWorker.once("error", reject);
      runningWorker.once("exit", () => {
        reject(new Error("Scheduled task recurrence worker exited"));
      });
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // 超时必须终止同步运算；等线程退出后才释放并发名额。
    try {
      await worker?.terminate();
    } finally {
      activeWorkers -= 1;
    }
  }
}
