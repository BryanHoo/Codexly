import { randomUUID } from "node:crypto";
import { AgentTurnNotSubmittedError, type AgentProviderTurnInput } from "@codexly/core";
import type { HistoricalTaskAttachments } from "@codexly/core/task-attachments";
import type { AcpConnection } from "./connection.js";
import type { AcpEventProjection } from "./event-projection.js";
import { prepareAcpPrompt, submitAcpTurn } from "./turn-submission.js";

/** 调用方持有任务串行锁，附件准备结束后再次确认原会话仍有前台工作。 */
export function steerAcpTurn(
  agent: AcpConnection | undefined,
  sessionId: string | undefined,
  projection: AcpEventProjection | undefined,
  turnId: string,
  input: AgentProviderTurnInput,
  directory: string,
  historyAttachments: HistoricalTaskAttachments,
): Promise<void> {
  return submitAcpTurn(async (submitted, onRollback) => {
    if (
      !agent ||
      !sessionId ||
      !projection?.running ||
      projection.turnId !== turnId ||
      !agent.canSteerSession(sessionId)
    )
      throw new AgentTurnNotSubmittedError("目标 ACP 回合无法接收引导");
    const prompt = await prepareAcpPrompt(agent, directory, projection.taskId, input, onRollback);
    const attachments = await historyAttachments.prepare(projection.taskId, input);
    if (!agent.canSteerSession(sessionId))
      throw new AgentTurnNotSubmittedError("目标 ACP 回合已结束");
    // 禁止扩展在空闲时开启新回合；超时及断线后的结果视为未知。
    const delivery = agent.transport.agent
      .request<{ outcome?: string; reason?: string } | null>(
        "_session/steering",
        { sessionId, prompt, _meta: { steering: { idleBehavior: "promptRequired" } } },
        { cancellationSignal: AbortSignal.timeout(25_000), stopWaitingOnCancel: true },
      )
      .then((reply) => {
        if (reply?.outcome === "promptRequired" && reply.reason === "noRunningTurn")
          throw new AgentTurnNotSubmittedError("目标回合已无法接收引导");
        submitted();
        if (reply?.outcome !== "injected") throw new Error("ACP 引导结果无法确认");
        projection.userMessage(`acp:message:user:${randomUUID()}`, input.text, attachments);
      });
    projection.pendingSteer = delivery;
    try {
      await delivery;
    } catch (error) {
      // 结果未知时保留可能已交给 Agent 的附件，明确拒绝时回滚本次准备。
      if (!(error instanceof AgentTurnNotSubmittedError)) submitted();
      throw error;
    } finally {
      projection.pendingSteer = undefined;
    }
  });
}
