import * as acp from "@agentclientprotocol/sdk/unstable";

const CANCEL_GRACE_MS = 5_000;

export interface ActivePrompt {
  abandoned: PromiseWithResolvers<never>;
  foregroundActive: boolean;
}

export interface PendingCancellation {
  sent: boolean;
  timedOut: boolean;
  write: Promise<void>;
  finish(): void;
}

/** 原始取消响应未到达前，保留会话隔离和回合结果未知的语义。 */
export function cancelAcpPrompt(
  sessionId: string,
  cancellations: Map<string, PendingCancellation>,
  activePrompts: ReadonlyMap<string, ActivePrompt>,
  transport: acp.ClientConnection,
  onTimeout: () => void,
): Promise<void> {
  const existing = cancellations.get(sessionId);
  if (existing) return existing.write;
  if (!activePrompts.has(sessionId)) return Promise.resolve();
  const finished = Promise.withResolvers<undefined>();
  // 超时只结算目标回合为结果未知；原通知与响应收敛前禁止在同一会话发送新 prompt。
  const timeout = () => {
    if (cancellation.timedOut) return;
    cancellation.timedOut = true;
    clearTimeout(timer);
    const active = activePrompts.get(sessionId);
    if (active) active.abandoned.reject(new Error("Agent 未确认取消，回合结果未知"));
    finished.resolve(undefined);
    onTimeout();
  };
  const timer = setTimeout(timeout, CANCEL_GRACE_MS);
  timer.unref();
  const cancellation: PendingCancellation = {
    sent: false,
    timedOut: false,
    write: finished.promise,
    finish: () => {
      clearTimeout(timer);
      if (cancellations.get(sessionId) === cancellation) cancellations.delete(sessionId);
      finished.resolve(undefined);
    },
  };
  cancellations.set(sessionId, cancellation);
  cancellation.write = Promise.race([
    transport.agent.notify(acp.methods.agent.session.cancel, { sessionId }).then(() => {
      cancellation.sent = true;
      if (!activePrompts.has(sessionId)) cancellation.finish();
    }, timeout),
    finished.promise,
  ]);
  return cancellation.write;
}
