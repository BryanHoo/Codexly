import { existsSync, writeFileSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";

const startupMarker = `${workerData.databasePath}.started`;
const firstWorker = !existsSync(startupMarker);
if (firstWorker) {
  writeFileSync(startupMarker, "started", "utf8");
}

parentPort?.on("message", (message) => {
  if (message.operation === "close") {
    parentPort?.postMessage({ id: message.id, result: null, type: "response" });
    parentPort?.close();
    return;
  }
  // 第一代 Worker 模拟永久阻塞；重建后的 Worker 恢复正常响应。
  if (!firstWorker) {
    parentPort?.postMessage({ id: message.id, result: [], type: "response" });
  }
});
parentPort?.postMessage({ type: "ready" });
