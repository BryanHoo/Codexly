import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

export interface RuntimeInstanceLock {
  close(): Promise<void>;
  signal: AbortSignal;
}

export async function acquireRuntimeLock(codexHome: string): Promise<RuntimeInstanceLock> {
  const directory = join(codexHome, "codexly");
  await mkdir(directory, { recursive: true });
  const path = join(await realpath(directory), "instance.sqlite3");
  const worker = new Worker(new URL("./runtime-instance-worker.js", import.meta.url), {
    workerData: { path },
  });
  const controller = new AbortController();
  let closing = false;
  const failure = new Error("Codexly 实例锁已失效，正在停止运行");
  worker.on("error", () => {
    controller.abort(failure);
  });
  worker.on("exit", () => {
    if (!closing) controller.abort(failure);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        finish(new Error("获取 Codexly 实例锁超时"));
      }, 10_000);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        worker.off("message", onMessage);
        controller.signal.removeEventListener("abort", onAbort);
        if (error) reject(error);
        else resolve();
      };
      const onAbort = () => {
        finish(failure);
      };
      const onMessage = (message: { type: string; busy?: boolean }) => {
        finish(
          message.type === "ready"
            ? undefined
            : new Error(
                message.busy
                  ? "同一数据目录已有 Codexly 实例运行，请使用已有实例或指定其他 --codex-home"
                  : "无法获取 Codexly 实例锁",
              ),
        );
      };
      worker.on("message", onMessage);
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
  } catch (error) {
    closing = true;
    await worker.terminate();
    throw error;
  }
  return {
    signal: controller.signal,
    async close() {
      closing = true;
      // 由操作系统随 Worker/进程退出释放 SQLite 锁，崩溃后无需清理陈旧 PID 文件。
      await worker.terminate();
    },
  };
}
