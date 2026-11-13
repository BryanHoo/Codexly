import type { SessionUpdate } from "@agentclientprotocol/sdk/unstable";
import type { AgentTurn } from "@codexly/protocol";
import type { AcpHistory } from "./history.js";
import { AcpEventProjection } from "./event-projection.js";
import { replayFingerprint, type AcpHistoryEntry } from "./replay-anchor.js";

/** ACP v1 不提供历史回合分页；按消息边界逐回合生成应用投影，并为文件写入提供背压。 */
export class AcpReplay {
  readonly #writer: WritableStreamDefaultWriter<AgentTurn>;
  readonly #saved: Promise<void>;
  #current: AcpEventProjection | undefined;
  #replySeen = false;
  #userId: string | undefined;
  #counter = 0;
  constructor(
    history: AcpHistory,
    readonly taskId: string,
  ) {
    const stream = new TransformStream<AgentTurn, AgentTurn>();
    this.#writer = stream.writable.getWriter();
    const source = async function* () {
      const reader = stream.readable.getReader();
      const previous = history.entries(taskId);
      let aligned = true;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          const old = aligned ? await previous.next() : undefined;
          if (
            old &&
            !old.done &&
            (old.value.replayFingerprint ?? replayFingerprint(old.value.turn)) ===
              replayFingerprint(next.value)
          ) {
            // 只有同位置的完整内容匹配才保留应用身份和附件；一次错位后不猜测后续对应关系。
            yield old.value;
          } else {
            aligned = false;
            yield { turn: next.value } satisfies AcpHistoryEntry;
          }
        }
      } finally {
        // 消费者提前退出时解除写侧背压，磁盘/锁错误不能留下永久等待的 producer。
        await reader.cancel();
        reader.releaseLock();
        await previous.return(undefined);
      }
    };
    this.#saved = history.replace(taskId, source());
    // 写盘失败立即撤销生产者，避免磁盘故障后仍等待没人消费的重放队列。
    void this.#saved
      .catch((error: unknown) => stream.readable.cancel(error))
      .catch(() => undefined);
  }
  async update(update: SessionUpdate): Promise<void> {
    if (update.sessionUpdate === "user_message_chunk") {
      const id = update.messageId ?? undefined;
      if (
        this.#current &&
        (this.#replySeen || (id !== undefined && this.#userId !== undefined && id !== this.#userId))
      )
        await this.#flush();
      this.#userId = id;
    }
    const content =
      update.sessionUpdate === "user_message_chunk" ||
      update.sessionUpdate === "agent_message_chunk" ||
      update.sessionUpdate === "agent_thought_chunk" ||
      update.sessionUpdate === "tool_call" ||
      update.sessionUpdate === "tool_call_update" ||
      update.sessionUpdate === "plan";
    if (!content) return;
    if (!this.#current) {
      const id =
        update.sessionUpdate === "user_message_chunk" && update.messageId
          ? update.messageId
          : String(++this.#counter);
      this.#current = new AcpEventProjection(this.taskId, `acp:history:${id}`, () => undefined);
    }
    if (update.sessionUpdate !== "user_message_chunk") this.#replySeen = true;
    this.#current.update(update);
  }
  async #flush(): Promise<void> {
    if (!this.#current) return;
    const turn = this.#current.finish("end_turn");
    // 上游重放缺少回合时间，保持未知，不能以本次读取时间伪造历史发生时间。
    await this.#writer.write({ ...turn, startedAt: null, completedAt: null });
    this.#current = undefined;
    this.#replySeen = false;
    this.#userId = undefined;
  }
  async complete(): Promise<void> {
    await this.#flush();
    await this.#writer.close();
    await this.#saved;
  }
  async abort(error: unknown): Promise<void> {
    await this.#writer.abort(error);
    await this.#saved.catch(() => undefined);
  }
}
