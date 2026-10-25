import { createConversationExport } from "@codexly/frontend-core/conversation-export";
import type { AgentTask } from "@codexly/protocol";
import type { NativeWorkbenchClient } from "../projects/project-queries.js";
import { saveConversationExport } from "../../platform/tauri/conversation-export.js";

export async function exportTaskConversation(client: NativeWorkbenchClient, task: AgentTask): Promise<string | null> {
  return saveConversationExport(await createConversationExport(client, task));
}
