import { parentPort, workerData } from "node:worker_threads";
import Database from "better-sqlite3";

let database;
try {
  // 独立数据库只承载进程所有权，不阻塞业务数据库或随业务 Worker 重建。
  database = new Database(workerData.path, { timeout: 0 });
  database.exec("BEGIN EXCLUSIVE");
  parentPort.on("message", () => {
    database.close();
    parentPort.close();
  });
  parentPort.postMessage({ type: "ready" });
} catch (error) {
  database?.close();
  parentPort.postMessage({ type: "failed", busy: error?.code === "SQLITE_BUSY" });
  parentPort.close();
}
