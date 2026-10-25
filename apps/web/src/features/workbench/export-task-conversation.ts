import { createConversationExport } from "@codexly/frontend-core/conversation-export";
import type { AgentTask } from "@codexly/protocol";
import type { CodexlyReadClient } from "../projects/project-queries.js";
import { downloadFile } from "../../shared/utils/download-file.js";

export async function exportTaskConversation(
  client: CodexlyReadClient,
  task: AgentTask,
): Promise<string> {
  const file = await createConversationExport(client, task);
  downloadFile(file.fileName, file.content);
  return file.fileName;
}
