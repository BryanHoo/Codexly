import { createHash } from "node:crypto";
import { join } from "node:path";
import type { ContentBlock } from "@agentclientprotocol/sdk/experimental/v2/unstable";
import type { AcpConnection } from "./connection.js";
import type { AcpEventProjection } from "./event-projection.js";
import { AgentTurnNotSubmittedError, type AgentProviderTurnInput } from "@codexly/core";
import { createAcpPrompt } from "./turn-input.js";

export function prepareAcpPrompt(
  agent: AcpConnection,
  directory: string,
  taskId: string,
  input: AgentProviderTurnInput,
  onRollback: (cleanup: () => Promise<void>) => void,
): Promise<ContentBlock[]> {
  return createAcpPrompt(
    input,
    agent.initialization.capabilities?.session?.prompt ?? {},
    join(directory, "attachments", createHash("sha256").update(taskId).digest("hex")),
    onRollback,
  );
}

/** 只在调用 ACP prompt 前声明“未提交”；一旦进入传输，断线和超时均保持结果未知。 */
export async function submitAcpTurn<T>(
  operation: (
    submitted: () => void,
    onRollback: (cleanup: () => Promise<void>) => void,
  ) => Promise<T>,
): Promise<T> {
  const state = { submitted: false };
  let rollback: (() => Promise<void>) | undefined;
  try {
    return await operation(
      () => {
        state.submitted = true;
        rollback = undefined;
      },
      (cleanup) => {
        rollback = cleanup;
      },
    );
  } catch (error) {
    if (state.submitted) throw error;
    // 必须等待回滚完成才报告未提交；进入 prompt 后不能据失败响应删除仍可能被 Agent 使用的文件。
    try {
      await rollback?.();
    } catch (cleanupError) {
      throw new AgentTurnNotSubmittedError("ACP 输入未提交，附件清理失败", {
        cause: new AggregateError([error, cleanupError]),
      });
    }
    if (error instanceof AgentTurnNotSubmittedError) throw error;
    throw new AgentTurnNotSubmittedError(
      error instanceof Error ? error.message : "ACP 输入未提交",
      { cause: error },
    );
  }
}

/** 应用持久化的发送身份贯穿 ACP。回执继续绑定本地回合，供界面及历史合并使用。 */
export async function sendAcpPrompt(
  agent: AcpConnection,
  sessionId: string,
  prompt: ContentBlock[],
  projection: AcpEventProjection,
  submissionKey?: string,
) {
  const idempotencyKey = submissionKey
    ? createHash("sha256").update("codexly-acp:").update(submissionKey).digest("hex")
    : projection.turnId;
  const result = await agent
    .prompt(
      { sessionId, prompt, idempotencyKey },
      {
        turnId: projection.turnId,
        accept: (messageId) => {
          projection.acpMessageId = messageId;
        },
      },
    )
    .then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
  // 原回合的终态可以先于引导回执到达，持久化前先投影已受理的用户消息。
  await projection.pendingSteer?.catch(() => undefined);
  return "value" in result
    ? projection.finish(result.value.stopReason)
    : projection.fail(result.error instanceof Error ? result.error.message : "ACP 连接失败");
}
