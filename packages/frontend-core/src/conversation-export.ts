import type { AgentTask } from "@codexly/protocol";
import type { ExportClient } from "./conversation-export-collector.js";
export { MAX_CONVERSATION_EXPORT_BYTES } from "./conversation-export-collector.js";
export type { ConversationRecord } from "./conversation-export-collector.js";

export interface ConversationExportFile {
  fileName: string;
  content: Blob;
}
export type ExportWorkerRequest =
  | { type: "start"; task: AgentTask; exportedAt: string }
  | { type: "page"; page: Awaited<ReturnType<ExportClient["readTask"]>> };
export type ExportWorkerResponse =
  | { type: "read"; options: Parameters<ExportClient["readTask"]>[2] }
  | { type: "done"; file: ConversationExportFile }
  | { type: "error"; name: string; message: string };

/** 两端仅在点击导出后创建专用 Worker；完成或任意失败都终止，释放历史、索引和中间缓冲。 */
export async function createConversationExport(
  client: ExportClient,
  task: AgentTask,
  exportedAt = new Date(),
): Promise<ConversationExportFile> {
  const worker = new Worker(new URL("./conversation-export-worker.ts", import.meta.url), {
    type: "module",
  });
  try {
    return await new Promise<ConversationExportFile>((resolve, reject) => {
      worker.onerror = () => {
        reject(new Error("Conversation export worker failed"));
      };
      worker.onmessageerror = () => {
        reject(new Error("Conversation export worker message failed"));
      };
      worker.onmessage = (event: MessageEvent<ExportWorkerResponse>) => {
        const message = event.data;
        if (message.type === "done") resolve(message.file);
        else if (message.type === "error")
          reject(
            message.name === "RangeError"
              ? new RangeError(message.message)
              : new Error(message.message),
          );
        else {
          // Worker 一次只请求一页；读取和处理串行背压，主线程不积攒整份历史或待处理消息队列。
          void Promise.resolve()
            .then(() => client.readTask(task.projectId, task.id, message.options))
            .then((page) => {
              worker.postMessage({ type: "page", page } satisfies ExportWorkerRequest);
            })
            .catch(reject);
        }
      };
      worker.postMessage({
        type: "start",
        task,
        exportedAt: exportedAt.toISOString(),
      } satisfies ExportWorkerRequest);
    });
  } finally {
    worker.terminate();
  }
}
