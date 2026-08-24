import { writeFile } from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";

parentPort?.on("message", (message) => {
  if (message.operation !== "close") {
    return;
  }
  parentPort?.postMessage({ id: message.id, result: null, type: "response" });
  setTimeout(async () => {
    // 模拟数据库关闭响应后的异步资源清理，必须在 Worker 自然退出前完成。
    await writeFile(`${workerData.databasePath}.closed`, "closed", "utf8");
    parentPort?.close();
  }, 50);
});
parentPort?.postMessage({ type: "ready" });
