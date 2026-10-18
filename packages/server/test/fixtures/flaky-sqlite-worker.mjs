import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import { serializeError } from "../../src/sqlite-worker-error.js";

const marker = `${workerData.databasePath}.start-count`;
const generation = existsSync(marker) ? Number(readFileSync(marker, "utf8")) + 1 : 1;
writeFileSync(marker, String(generation), "utf8");

if (generation === 2) {
  // 第二代模拟可恢复的环境故障，同时验证真实 Worker 边界会保留 SQLite 错误码。
  const error = Object.assign(new Error("temporary startup failure"), { code: "SQLITE_CANTOPEN" });
  parentPort.postMessage({ type: "fatal", error: serializeError(error) });
  parentPort.close();
} else {
  parentPort.on("message", (message) => {
    if (message.operation === "close") {
      parentPort.postMessage({ type: "response", id: message.id, result: null });
      parentPort.close();
    } else if (generation > 1) {
      // 第一代始终不响应业务请求，第三代开始恢复正常读取。
      parentPort.postMessage({ type: "response", id: message.id, result: [] });
    }
  });
  parentPort.postMessage({ type: "ready" });
}
