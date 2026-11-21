import { ContentBlock, SessionUpdate } from "@agentclientprotocol/sdk/experimental/v2/unstable";
import type { AgentTurn } from "@codexly/protocol";
import type { AcpHistory } from "./history.js";
import { AcpEventProjection } from "./event-projection.js";
import { replayFingerprint, type AcpHistoryEntry } from "./replay-anchor.js";
import { stripAcpGlobalInstructions } from "./global-instructions.js";
import type { AcpTurnContent } from "./turn-content.js";

const ALIGNMENT_WINDOW = 8;
interface ReplayTurn {
  turn: AgentTurn;
  content: AcpTurnContent;
}

/** ACP v2 以会话通知回放历史；按消息边界逐回合生成应用投影，并为文件写入提供背压。 */
export class AcpReplay {
  readonly #writer: WritableStreamDefaultWriter<ReplayTurn>;
  readonly #saved: Promise<void>;
  #current: AcpEventProjection | undefined;
  #userId: string | undefined;
  #counter = 0;
  // 只暂存可能属于应用指令的用户文本前缀，普通消息的后续分块直接进入投影。
  #userPrefix: string | undefined = "";
  constructor(
    history: AcpHistory,
    readonly taskId: string,
  ) {
    const stream = new TransformStream<ReplayTurn, ReplayTurn>();
    const attachments = history.cache.content(taskId);
    this.#writer = stream.writable.getWriter();
    const source = async function* () {
      const reader = stream.readable.getReader();
      const previous = history.entries(taskId, true);
      const candidates: { entry: AcpHistoryEntry; fingerprint: string }[] = [];
      let aligned = true;
      let exhausted = false;
      const fill = async (length: number) => {
        while (!exhausted && candidates.length < length) {
          const old = await previous.next();
          if (old.done) exhausted = true;
          else
            candidates.push({
              entry: old.value,
              fingerprint: old.value.replayFingerprint ?? replayFingerprint(old.value.turn),
            });
        }
      };
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          const { turn, content } = next.value;
          const fingerprint = content.fingerprint(turn);
          await fill(1);
          let index = candidates[0]?.fingerprint === fingerprint && aligned ? 0 : -1;
          if (index < 0 && candidates.length) {
            // 短暂错位后只按有界窗口内唯一的完整指纹恢复顺序，重复内容不猜测身份。
            aligned = false;
            const moving = candidates.length === ALIGNMENT_WINDOW;
            await fill(ALIGNMENT_WINDOW);
            const first = candidates.findIndex(
              (candidate) => candidate.fingerprint === fingerprint,
            );
            if (
              first >= 0 &&
              !candidates
                .slice(first + 1)
                .some((candidate) => candidate.fingerprint === fingerprint)
            )
              index = first;
            else if (moving) candidates.shift();
          }
          if (index >= 0) {
            const matched = candidates.splice(0, index + 1).at(-1);
            if (matched) yield matched.entry;
            aligned = true;
            continue;
          }
          const projected = await content.materialize(turn, attachments, taskId);
          yield {
            turn: projected,
            ...(turn !== projected ? { replayFingerprint: fingerprint } : {}),
          } satisfies AcpHistoryEntry;
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
    if (SessionUpdate.isUserMessage(update)) {
      if (this.#current && this.#userId !== update.messageId) await this.#flush();
      this.#userId = update.messageId;
      this.#userPrefix = undefined;
      if (update.content) {
        update = {
          ...update,
          content: update.content.flatMap<ContentBlock>((block) => {
            if (!ContentBlock.isText(block)) return [block];
            const text = stripAcpGlobalInstructions(block.text);
            return text ? [{ ...block, text }] : [];
          }),
        };
      }
    } else if (SessionUpdate.isUserMessageChunk(update)) {
      const id = update.messageId;
      if (this.#current && this.#userId !== undefined && id !== this.#userId) await this.#flush();
      this.#userId = id;
      if (this.#userPrefix !== undefined && ContentBlock.isText(update.content)) {
        const prefix = this.#userPrefix + update.content.text;
        const text = stripAcpGlobalInstructions(prefix);
        if (text === null) {
          this.#userPrefix = prefix;
          return;
        }
        this.#userPrefix = undefined;
        if (!text && prefix) return;
        update = { ...update, content: { ...update.content, text } };
      } else {
        this.#flushUserPrefix();
      }
    } else if (
      update.sessionUpdate === "agent_message_chunk" ||
      update.sessionUpdate === "agent_message"
    ) {
      this.#flushUserPrefix();
    }
    const content =
      update.sessionUpdate === "user_message_chunk" ||
      update.sessionUpdate === "agent_message_chunk" ||
      update.sessionUpdate === "agent_thought_chunk" ||
      update.sessionUpdate === "user_message" ||
      update.sessionUpdate === "agent_message" ||
      update.sessionUpdate === "agent_thought" ||
      update.sessionUpdate === "tool_call_update" ||
      update.sessionUpdate === "plan_update" ||
      update.sessionUpdate === "plan_removed";
    if (!content) return;
    if (!this.#current) {
      const id = this.#userId ?? String(++this.#counter);
      this.#current = new AcpEventProjection(this.taskId, `acp:history:${id}`, () => undefined);
    }
    this.#current.update(update);
  }
  #flushUserPrefix(): void {
    const text = this.#userPrefix;
    this.#userPrefix = undefined;
    // 前缀残缺时按普通用户文本保留，避免截断用户实际输入。
    if (!text) return;
    this.#current ??= new AcpEventProjection(
      this.taskId,
      "acp:history:" + (this.#userId ?? String(++this.#counter)),
      () => undefined,
    );
    this.#current.update({
      sessionUpdate: "user_message_chunk",
      messageId: this.#userId ?? "user",
      content: { type: "text", text },
    });
  }
  async #flush(): Promise<void> {
    this.#flushUserPrefix();
    this.#userPrefix = "";
    if (!this.#current) return;
    const turn = this.#current.finish("end_turn");
    // 上游重放缺少回合时间，保持未知，不能以本次读取时间伪造历史发生时间。
    await this.#writer.write({
      turn: { ...turn, startedAt: null, completedAt: null },
      content: this.#current.content,
    });
    this.#current = undefined;
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
