import { parentPort, workerData } from "node:worker_threads";
import { previewScheduledTask } from "./scheduled-task-recurrence-engine.ts";
import * as wallTime from "../../protocol/src/scheduled-task-wall-time.ts";

// 源码运行由 Node 去除类型；发布构建将依赖一并打包到 Worker。
try {
  const { schedule, afterUnixMs, limit } = workerData;
  parentPort.postMessage({ dates: previewScheduledTask(schedule, afterUnixMs, limit, wallTime) });
} catch (error) {
  parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
}
