import { createConversationExport } from "@codexly/frontend-core/conversation-export";
import type { AgentTask } from "@codexly/protocol";
import type { NativeWorkbenchClient } from "../projects/project-queries.js";
import { saveConversationExport } from "../../platform/tauri/conversation-export.js";

export async function exportTaskConversation(client: NativeWorkbenchClient, task: AgentTask): Promise<string | null> {
  const file = await createConversationExport(client, task);
  // 原生保存命令仍接收字符串；延迟到 Worker 已终止后再异步解码，不与历史和索引同时驻留。
  return saveConversationExport({ fileName: file.fileName, content: await file.content.text() });
}
