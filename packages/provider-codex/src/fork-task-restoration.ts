import type { AgentTaskScope, ListAgentTasksInput } from "@codexly/core";
import type { AgentTask } from "@codexly/protocol";
import type { CodexRpcClient } from "./codex-rpc-client.js";
import { expectRecord, isProjectThread, mapAgentTask } from "./codex-protocol-mapping.js";
import {
  isBackgroundTerminalThreadMissingError,
  isThreadNotLoadedError,
} from "./agent-provider-base.js";
import type { ForkTaskRegistry } from "./fork-task-registry.js";
import type { TaskRuntimeState } from "./task-runtime-state.js";

export async function restoreUnlistedForks(
  client: CodexRpcClient,
  registry: ForkTaskRegistry | undefined,
  project: AgentTaskScope,
  runtime: TaskRuntimeState,
  nativeTasks: AgentTask[],
  input: ListAgentTasksInput,
): Promise<void> {
  for (const task of nativeTasks) {
    runtime.projectTaskIds.add(task.id);
    runtime.unmaterializedTasks.delete(task.id);
  }
  if (
    registry === undefined ||
    input.cursor !== undefined ||
    input.archived === true ||
    input.searchTerm !== undefined
  ) {
    return;
  }
  const nativeIds = new Set(nativeTasks.map((task) => task.id));
  for (const taskId of await registry.list(project.id)) {
    if (nativeIds.has(taskId)) {
      await registry.forget(project.id, taskId);
      continue;
    }
    let response: Record<string, unknown>;
    try {
      response = expectRecord(
        await client.request("thread/read", { includeTurns: false, threadId: taskId }),
        "thread/read response",
      );
    } catch (error) {
      if (!isThreadNotLoadedError(error) && !isBackgroundTerminalThreadMissingError(error)) {
        throw error;
      }
      await registry.forget(project.id, taskId);
      runtime.unmaterializedTasks.delete(taskId);
      continue;
    }
    const thread = expectRecord(response["thread"], "thread/read thread");
    if (thread["id"] !== taskId || !isProjectThread(thread, project)) {
      await registry.forget(project.id, taskId);
      runtime.unmaterializedTasks.delete(taskId);
      continue;
    }
    const path = thread["path"];
    if (typeof path === "string" && /[/\\]archived_sessions[/\\]/u.test(path)) {
      runtime.unmaterializedTasks.delete(taskId);
      continue;
    }
    // 原生列表排除无预览的持久 Thread；用原生读取恢复元数据，不复制对话内容。
    const task = await mapAgentTask(thread, project);
    runtime.projectTaskIds.add(task.id);
    runtime.unmaterializedTasks.set(task.id, task);
  }
}

export function pendingLocalTasks(
  runtime: TaskRuntimeState,
  input: ListAgentTasksInput,
): AgentTask[] {
  if (input.cursor !== undefined || input.archived === true || input.searchTerm !== undefined) {
    return [];
  }
  return [...runtime.unmaterializedTasks.values()].toSorted((leftTask, rightTask) =>
    rightTask.updatedAt.localeCompare(leftTask.updatedAt),
  );
}
