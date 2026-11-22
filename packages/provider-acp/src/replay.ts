import type { SessionUpdate } from "@agentclientprotocol/sdk/unstable";
import { MAX_AGENT_TEXT_BYTES, type AgentItem, type AgentTurn } from "@codexly/protocol";
import { HistoricalTaskAttachments } from "@codexly/core/task-attachments";
import { join } from "node:path";
import type { AcpHistory } from "./history.js";
import { AcpEventProjection, contentText } from "./event-projection.js";
import { isAcpDiffItem, replayFingerprint, type AcpHistoryEntry } from "./replay-anchor.js";
import { stripAcpGlobalInstructions } from "./global-instructions.js";
import type { AcpTurnContent } from "./turn-content.js";

const ALIGNMENT_WINDOW = 8;
type UserMessage = Extract<AgentItem, { type: "message" }>;
type UserUpdate = Extract<SessionUpdate, { sessionUpdate: "user_message" | "user_message_chunk" }>;

function replayUserUpdate(update: SessionUpdate): UserUpdate | undefined {
  if (update.sessionUpdate === "user_message_chunk") return update;
  return undefined;
}

async function matchesSteering(
  echoed: string,
  message: UserMessage,
  storage: HistoricalTaskAttachments,
  taskId: string,
): Promise<boolean> {
  if (echoed && echoed === message.text) return true;
  if (!echoed.startsWith(message.text)) return false;
  let rest = echoed.slice(message.text.length);
  const attachments = message.attachments ?? [];
  // 按提交顺序核对附件展开后的正文。Codex 会将文件引用回放成带 @ 的 Markdown 链接。
  for (const attachment of attachments) {
    if (attachment.kind !== "text") continue;
    const stored = await storage.read(taskId, attachment.id);
    if (!stored) return false;
    const text = attachment.name + "\n" + new TextDecoder().decode(stored.content);
    if (!rest.startsWith(text)) return false;
    rest = rest.slice(text.length);
  }
  for (const { kind, name } of attachments) {
    if (kind === "text") continue;
    if (kind === "image" && rest.startsWith("[图片]")) {
      rest = rest.slice("[图片]".length);
      continue;
    }
    const prefix = [`[${name}](file://`, `[@${name}](file://`].find((link) =>
      rest.startsWith(link),
    );
    const end = prefix === undefined ? -1 : rest.indexOf(")", prefix.length);
    if (end < 0) return false;
    rest = rest.slice(end + 1);
  }
  return echoed.length > 0 && rest.length === 0;
}

interface ReplayTurn {
  turn: AgentTurn;
  content: AcpTurnContent;
  messageId?: string;
}

/** ACP v1 以会话通知回放历史；按消息边界逐回合生成应用投影，并为文件写入提供背压。 */
export class AcpReplay {
  readonly #writer: WritableStreamDefaultWriter<SessionUpdate>;
  readonly #saved: Promise<void>;
  #current: AcpEventProjection | undefined;
  #userId: string | undefined;
  #firstUserId: string | undefined;
  #firstNativeUserId: string | undefined;
  readonly #syntheticIds = new WeakSet<object>();
  #steeringCount = 0;
  #counter = 0;
  #wireCounter = 0;
  #wireRole = "";
  #wireId = "";
  // 只暂存可能属于应用指令的用户文本前缀，普通消息的后续分块直接进入投影。
  #userPrefix: string | undefined = "";
  constructor(
    history: AcpHistory,
    readonly taskId: string,
  ) {
    const stream = new TransformStream<SessionUpdate, SessionUpdate>(undefined, undefined, {
      highWaterMark: 1,
    });
    const attachments = history.cache.content(taskId);
    const userAttachments = new HistoricalTaskAttachments(
      join(history.directory, "task-attachments"),
    );
    this.#writer = stream.writable.getWriter();
    const source = async function* (replay: AcpReplay) {
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
      const findSteering = async (firstId: string, incomingId: string, index: number) => {
        await fill(1);
        if (candidates[0]?.entry.acpMessageId !== firstId) await fill(ALIGNMENT_WINDOW);
        const original = candidates.find(({ entry }) => entry.acpMessageId === firstId);
        const messages = original?.entry.turn.items.filter(
          (item): item is UserMessage => item.type === "message" && item.role === "user",
        );
        const message = messages?.[index + 1];
        if (!message) return undefined;
        // 优先服从已知的独立发送回执，即使后续问题的正文恰好和引导相同。
        await fill(ALIGNMENT_WINDOW);
        if (candidates.some(({ entry }) => entry.acpMessageId === incomingId)) return undefined;
        return message;
      };
      try {
        for await (const { turn, content, messageId } of replay.#turns(
          reader,
          findSteering,
          userAttachments,
        )) {
          const fingerprint = content.fingerprint(turn);
          await fill(1);
          const matches = (candidate: (typeof candidates)[number]) =>
            messageId && candidate.entry.acpMessageId
              ? candidate.entry.acpMessageId === messageId
              : candidate.fingerprint === fingerprint;
          const firstCandidate = candidates[0];
          let index = firstCandidate && aligned && matches(firstCandidate) ? 0 : -1;
          if (index < 0 && candidates.length) {
            // 优先比较 Agent 消息 ID；旧回合仅在有界窗口内用唯一指纹恢复顺序。
            const moving = !aligned && candidates.length === ALIGNMENT_WINDOW;
            aligned = false;
            await fill(ALIGNMENT_WINDOW);
            const matchedId = messageId
              ? candidates.findIndex(({ entry }) => entry.acpMessageId === messageId)
              : -1;
            const first = candidates.findIndex(matches);
            if (matchedId >= 0) index = matchedId;
            else if (first >= 0 && !candidates.slice(first + 1).some(matches)) index = first;
            else if (moving) candidates.shift();
          }
          if (index >= 0) {
            const matched = candidates.splice(0, index + 1).at(-1);
            if (
              matched &&
              messageId &&
              matched.fingerprint !== fingerprint &&
              messageId === matched.entry.acpMessageId
            ) {
              // Agent 重放补齐了断线后的输出。保留本地回合身份、发送时间和原始用户附件。
              const old = matched.entry.turn;
              const user = old.items.find(
                (item) => item.type === "message" && item.role === "user",
              );
              const projected = await content.materialize(turn, attachments, taskId);
              const { stopReason: _replayReason, ...recovered } = projected;
              yield {
                turn: {
                  ...recovered,
                  id: old.id,
                  status: old.status,
                  error: old.error,
                  startedAt: old.startedAt,
                  completedAt: old.completedAt,
                  ...(old.stopReason ? { stopReason: old.stopReason } : {}),
                  items: projected.items.map((item) =>
                    user && item.id === `acp:message:user:${messageId}` ? user : item,
                  ),
                },
                replayFingerprint: fingerprint,
                acpMessageId: messageId,
              };
            } else if (matched) {
              const missing = turn.items.filter(
                (item) =>
                  isAcpDiffItem(item) &&
                  !matched.entry.turn.items.some((old) => old.id === item.id),
              );
              yield missing.length
                ? {
                    ...matched.entry,
                    turn: {
                      ...matched.entry.turn,
                      items: [...matched.entry.turn.items, ...missing],
                    },
                  }
                : matched.entry;
            }
            aligned = true;
            continue;
          }
          const projected = await content.materialize(turn, attachments, taskId);
          yield {
            turn: projected,
            ...(messageId
              ? { acpMessageId: messageId, replayFingerprint: fingerprint }
              : turn !== projected
                ? { replayFingerprint: fingerprint }
                : {}),
          } satisfies AcpHistoryEntry;
        }
      } finally {
        // 消费者提前退出时解除写侧背压，磁盘/锁错误不能留下永久等待的 producer。
        await reader.cancel();
        reader.releaseLock();
        await previous.return(undefined);
      }
    };
    this.#saved = history.replace(taskId, source(this));
    // 写盘失败立即撤销生产者，避免磁盘故障后仍等待没人消费的重放队列。
    void this.#saved
      .catch((error: unknown) => stream.readable.cancel(error))
      .catch(() => undefined);
  }
  update(update: SessionUpdate): Promise<void> {
    if (
      update.sessionUpdate === "user_message_chunk" ||
      update.sessionUpdate === "agent_message_chunk" ||
      update.sessionUpdate === "agent_thought_chunk"
    ) {
      const role = update.sessionUpdate;
      if (role !== this.#wireRole) {
        this.#wireRole = role;
        this.#wireId = `local-${String(++this.#wireCounter)}`;
      }
      if (!update.messageId) {
        // 局部 ID 只用于分块归组，不能冒充原生消息身份或写入接受回执。
        update = { ...update, messageId: this.#wireId };
        this.#syntheticIds.add(update);
      }
    }
    // 会话级通知已由连接层处理，不能截断正在核对的引导正文分块。
    switch (update.sessionUpdate) {
      case "user_message_chunk":
      case "agent_message_chunk":
      case "agent_thought_chunk":
      case "tool_call":
      case "tool_call_update":
      case "plan":
      case "plan_update":
      case "plan_removed":
        return this.#writer.write(update);
      default:
        return Promise.resolve();
    }
  }

  async *#turns(
    reader: ReadableStreamDefaultReader<SessionUpdate>,
    findSteering: (
      firstId: string,
      incomingId: string,
      index: number,
    ) => Promise<UserMessage | undefined>,
    attachments: HistoricalTaskAttachments,
  ): AsyncGenerator<ReplayTurn> {
    let next = await reader.read();
    while (!next.done) {
      const update = next.value;
      const user = replayUserUpdate(update);
      if (user && this.#userId !== undefined && this.#userId !== user.messageId) {
        const id = user.messageId ?? "user";
        const steering = this.#firstUserId
          ? await findSteering(this.#firstUserId, id, this.#steeringCount)
          : undefined;
        if (steering) {
          // 只暂存一条待确认的用户消息，折叠分块与全量替换，并对缓冲设置上限。
          let text = "";
          let fragment: UserUpdate | undefined = user;
          while (fragment?.messageId === id) {
            text += contentText(fragment.content);
            next = await reader.read();
            if (text.length > MAX_AGENT_TEXT_BYTES * 2) break;
            fragment = next.done ? undefined : replayUserUpdate(next.value);
          }
          if (await matchesSteering(text, steering, attachments, this.taskId)) {
            this.#flushUserPrefix();
            this.#current?.userMessage(steering.id, steering.text, steering.attachments ?? []);
            this.#userId = id;
            this.#steeringCount++;
          } else {
            const turn = this.#finishTurn();
            if (turn) yield turn;
            this.#applyUpdate({
              sessionUpdate: "user_message_chunk",
              messageId: id,
              content: { type: "text", text },
            });
          }
          continue;
        }
        const turn = this.#finishTurn();
        if (turn) yield turn;
      }
      this.#applyUpdate(update);
      next = await reader.read();
    }
    const turn = this.#finishTurn();
    if (turn) yield turn;
  }

  #applyUpdate(update: SessionUpdate): void {
    if (update.sessionUpdate === "user_message_chunk") {
      const id = update.messageId ?? "user";
      if (this.#firstUserId === undefined) {
        this.#firstUserId = id;
        if (!this.#syntheticIds.has(update)) this.#firstNativeUserId = id;
      }
      this.#userId = id;
      if (this.#userPrefix !== undefined && update.content.type === "text") {
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
    } else if (update.sessionUpdate === "agent_message_chunk") {
      this.#flushUserPrefix();
    }
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
  #finishTurn(): ReplayTurn | undefined {
    this.#flushUserPrefix();
    this.#userPrefix = "";
    if (!this.#current) return;
    const turn = this.#current.finish("end_turn");
    // 上游重放缺少回合时间，保持未知，不能以本次读取时间伪造历史发生时间。
    const result: ReplayTurn = {
      turn: { ...turn, startedAt: null, completedAt: null },
      content: this.#current.content,
      ...(this.#firstNativeUserId ? { messageId: this.#firstNativeUserId } : {}),
    };
    this.#current = undefined;
    this.#userId = undefined;
    this.#firstUserId = undefined;
    this.#firstNativeUserId = undefined;
    this.#steeringCount = 0;
    return result;
  }
  async complete(): Promise<void> {
    await this.#writer.close();
    await this.#saved;
  }
  async abort(error: unknown): Promise<void> {
    await this.#writer.abort(error);
    await this.#saved.catch(() => undefined);
  }
}
