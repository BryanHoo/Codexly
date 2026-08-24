import type { AgentTask } from "@code-agent/protocol";

import { CodexProtocolMappingError, expectRecord } from "./codex-protocol-mapping.js";

type TaskArchiveRpcClient = Readonly<{
  request(method: string, params?: unknown): Promise<unknown>;
}>;

export async function archiveCodexTask(
  client: TaskArchiveRpcClient,
  taskId: string,
): Promise<void> {
  expectRecord(
    await client.request("thread/archive", { threadId: taskId }),
    "thread/archive response",
  );
}

export async function deleteCodexTask(client: TaskArchiveRpcClient, taskId: string): Promise<void> {
  expectRecord(
    await client.request("thread/delete", { threadId: taskId }),
    "thread/delete response",
  );
}

export async function unarchiveCodexTask(
  client: TaskArchiveRpcClient,
  taskId: string,
  mapThread: (thread: Record<string, unknown>) => Promise<AgentTask>,
): Promise<AgentTask> {
  const response = expectRecord(
    await client.request("thread/unarchive", { threadId: taskId }),
    "thread/unarchive response",
  );
  const task = await mapThread(expectRecord(response["thread"], "thread/unarchive thread"));
  if (task.id !== taskId) {
    throw new CodexProtocolMappingError("thread/unarchive returned a different thread");
  }
  return task;
}
