import type { AgentTaskScope } from "@codexly/core";
import type { AgentTask } from "@codexly/protocol";
import type { CodexRpcClient } from "./codex-rpc-client.js";
import {
  expectRecord,
  mapAgentTask,
  CODEX_PINNED_THREAD_SECTION_ID,
  CodexProtocolMappingError,
} from "./codex-protocol-mapping.js";

export async function pinCodexTask(
  client: CodexRpcClient,
  project: AgentTaskScope,
  taskId: string,
  pinned: boolean,
  readMetadata: () => Promise<AgentTask | undefined>,
): Promise<AgentTask> {
  expectRecord(
    await client.request("thread/section/move", {
      sectionId: pinned ? CODEX_PINNED_THREAD_SECTION_ID : null,
      threadId: taskId,
    }),
    "thread/section/move response",
  );
  if (client.readLocalTask !== undefined) {
    const task = await readMetadata();
    if (task === undefined) throw new Error("Task not found");
    return task;
  }
  const response = expectRecord(
    await client.request("thread/read", { includeTurns: false, threadId: taskId }),
    "thread/read response",
  );
  const task = await mapAgentTask(expectRecord(response["thread"], "thread/read thread"), project);
  if (task.id !== taskId) {
    throw new CodexProtocolMappingError("thread/read returned a different thread");
  }
  if (task.pinned !== pinned) {
    throw new CodexProtocolMappingError("thread/read returned a different pinned state");
  }
  return task;
}
