import { collectConversationExport } from "./conversation-export-collector.js";
import type { ExportClient } from "./conversation-export-collector.js";
import type { ExportWorkerRequest, ExportWorkerResponse } from "./conversation-export.js";

// 使用最小 Worker 端口类型，避免共享包同时引入 DOM 与 WebWorker 全局声明冲突。
const port = globalThis as unknown as {
  onmessage: (event: MessageEvent<ExportWorkerRequest>) => void;
  postMessage(message: ExportWorkerResponse): void;
};
let acceptPage: ((page: Awaited<ReturnType<ExportClient["readTask"]>>) => void) | undefined;
port.onmessage = (event) => {
  const message = event.data;
  if (message.type === "page") {
    const accept = acceptPage;
    acceptPage = undefined;
    accept?.(message.page);
    return;
  }
  // 网络/Tauri 读取仍在各端适配器执行；完整历史只驻留本 Worker，重计算不占 UI 线程。
  const client: ExportClient = {
    readTask: (_projectId, _taskId, options) =>
      new Promise((resolve) => {
        acceptPage = resolve;
        port.postMessage({ type: "read", options });
      }),
  };
  void collectConversationExport(client, message.task, new Date(message.exportedAt)).then(
    (file) => {
      port.postMessage({ type: "done", file });
    },
    (error: unknown) => {
      port.postMessage({
        type: "error",
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : "Conversation export failed",
      });
    },
  );
};
