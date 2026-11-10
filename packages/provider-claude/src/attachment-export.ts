import { exportTaskAttachment } from "@codexly/core/task-attachments";
import type { ClaudeAgentProvider } from "./provider.js";
export async function exportClaudeAttachment(
  provider: ClaudeAgentProvider,
  taskId: string,
  attachmentId: string,
) {
  if (!(await provider.readTaskMetadata(taskId))) throw new Error("Claude task not found");
  return exportTaskAttachment(provider.config.attachments, taskId, attachmentId);
}
