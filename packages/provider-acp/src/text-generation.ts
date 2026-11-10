import type { AgentProviderEventListener } from "@codexly/core";
import type { AgentTurn } from "@codexly/protocol";

interface GenerationSession {
  create(): Promise<{ id: string }>;
  subscribe(listener: AgentProviderEventListener): () => void;
  start(
    id: string,
    text: string,
    model: string | undefined,
    signal: AbortSignal,
  ): Promise<AgentTurn>;
  interrupt(id: string, turnId: string): Promise<void>;
  release(id: string): Promise<void>;
}

/** 辅助生成共用普通 ACP 回合；临时会话的取消、等待落盘和释放保持同一生命周期。 */
export async function generateAcpText(
  source: GenerationSession,
  text: string,
  model: string | undefined,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  const task = await source.create();
  const result = Promise.withResolvers<string>();
  const unsubscribe = source.subscribe((event) => {
    if (event.taskId !== task.id || event.type !== "turn.completed") return;
    const turn = event.payload.turn;
    if (turn.status !== "completed") {
      result.reject(new Error(turn.error ?? "ACP 辅助生成中断"));
      return;
    }
    const answer = turn.items
      .flatMap((item) => (item.type === "message" && item.role === "assistant" ? [item.text] : []))
      .join("\n")
      .trim();
    if (Buffer.byteLength(answer) > 128 * 1024) result.reject(new Error("ACP 辅助回答超过预算"));
    else result.resolve(answer);
  });
  // 提前接管拒绝，避免终态先于提交响应到达时出现未处理 Promise。
  void result.promise.catch(() => undefined);
  let submitted: AgentTurn | undefined;
  const abort = () => {
    result.reject(signal.reason);
    if (submitted) void source.interrupt(task.id, submitted.id).catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    submitted = await source.start(task.id, text, model, signal);
    if (signal.aborted) await source.interrupt(task.id, submitted.id);
    return await result.promise;
  } finally {
    signal.removeEventListener("abort", abort);
    unsubscribe();
    await source.release(task.id);
  }
}
