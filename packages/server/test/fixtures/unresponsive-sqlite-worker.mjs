import { parentPort } from "node:worker_threads";

// 模拟初始化成功后不再响应 RPC 的 Worker，用于验证有界关闭。
parentPort?.on("message", () => undefined);
parentPort?.postMessage({ type: "ready" });
