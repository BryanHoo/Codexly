import type { AgentTaskUnsubscribeStatus } from "@code-agent/core";
import type { CodexProviderLogger } from "./agent-provider-logger.js";
import { CodexProtocolMappingError, expectRecord, expectString } from "./codex-protocol-mapping.js";

type ThreadUnsubscribeClient = Readonly<{
  request(method: string, params?: unknown): Promise<unknown>;
}>;

export async function unsubscribeCodexThread(
  client: ThreadUnsubscribeClient,
  taskId: string,
): Promise<Exclude<AgentTaskUnsubscribeStatus, "busy">> {
  const response = expectRecord(
    await client.request("thread/unsubscribe", { threadId: taskId }),
    "thread/unsubscribe response",
  );
  const status = expectString(response["status"], "thread/unsubscribe status");
  if (status !== "notLoaded" && status !== "notSubscribed" && status !== "unsubscribed") {
    throw new CodexProtocolMappingError("thread/unsubscribe returned an unknown status");
  }
  return status;
}

export async function releaseCodexProjectThreads(
  client: ThreadUnsubscribeClient,
  logger: CodexProviderLogger,
  projectId: string,
  taskIds: readonly string[],
): Promise<void> {
  // Project 销毁不再等待本地 busy 条件，149 原生退订不会中断活动 Turn 或 terminal。
  const results = await Promise.allSettled(
    taskIds.map((taskId) => unsubscribeCodexThread(client, taskId)),
  );
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      logger.warn(
        {
          diagnosticCode: "thread_unsubscribe_failed",
          projectId,
          taskId: taskIds[index],
        },
        "Failed to unsubscribe Codex thread during Project release",
      );
    }
  }
}
