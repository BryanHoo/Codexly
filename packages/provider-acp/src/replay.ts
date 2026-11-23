import type { SessionUpdate } from "@agentclientprotocol/sdk/unstable";
import type { AgentItem, AgentTurn } from "@codexly/protocol";
import { HistoricalTaskAttachments } from "@codexly/core/task-attachments";
import { join } from "node:path";
import type { AcpHistory } from "./history.js";
import { matchesSteering, readSteeringCandidate, userUpdate } from "./replay-steering.js";
import { AcpEventProjection } from "./event-projection.js";
import {
  isAcpDiffItem,
  isReplaySubagentItem,
  replayFingerprint,
  type AcpHistoryEntry,
} from "./replay-anchor.js";
import { stripAcpGlobalInstructions } from "./global-instructions.js";
import type { AcpSubagentItem } from "./subagent-sessions.js";
import type { AcpTurnContent } from "./turn-content.js";

const ALIGNMENT_WINDOW = 8;
type UserMessage = Extract<AgentItem, { type: "message" }>;

/** 匹配旧回合后，在原来的顺序中补齐新增压缩实体，并按 ID 原位更新已有实体。 */
function mergeCompactions(
  base: readonly AgentItem[],
  incoming: readonly AgentItem[],
  replaceExisting: boolean,
): AgentItem[] {
  const compactions = new Map(
    incoming.flatMap((item) => (item.type === "compaction" ? [[item.id, item] as const] : [])),
  );
  if (!compactions.size) return [...base];

  const baseIds = new Set(base.map((item) => item.id));
  const messageOrder = base.filter((item) => item.type !== "compaction" && !isAcpDiffItem(item));
  const insertions = new Map<string | undefined, AgentItem[]>();
  let anchor: string | undefined;
  let ordinal = incoming.filter(
    (item) => item.type !== "compaction" && !isAcpDiffItem(item),
  ).length;
  for (let index = incoming.length - 1; index >= 0; index--) {
    const item = incoming[index];
    if (item === undefined) continue;
    if (item.type !== "compaction") {
      if (!isAcpDiffItem(item)) ordinal--;
      if (baseIds.has(item.id)) anchor = item.id;
    } else if (!baseIds.has(item.id)) {
      // 旧 Agent 的无 ID 消息使用客户端合成键。匹配回合后按邻接项或序号恢复位置。
      const key = anchor ?? messageOrder[ordinal]?.id;
      const items = insertions.get(key) ?? [];
      items.push(item);
      insertions.set(key, items);
    } else {
      anchor = item.id;
    }
  }
  return [
    ...base.flatMap((item) => [
      ...(insertions.get(item.id)?.reverse() ?? []),
      item.type === "compaction" && replaceExisting
        ? { ...item, ...compactions.get(item.id) }
        : item,
    ]),
    ...(insertions.get(undefined)?.reverse() ?? []),
  ];
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
  readonly #attachments: HistoricalTaskAttachments;
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
  readonly #subagentUpdates = new WeakMap<SessionUpdate, AcpSubagentItem>();
  #userPrefix: string | undefined = "";
  constructor(
    history: AcpHistory,
    readonly taskId: string,
  ) {
    const stream = new TransformStream<SessionUpdate, SessionUpdate>(undefined, undefined, {
      highWaterMark: 1,
    });
    const attachments = (this.#attachments = history.cache.content(taskId));
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
        return candidates.length;
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
          let legacyFingerprint: string | undefined;
          // 已提交的本地后台段没有原生 prompt 身份，按历史顺序保留。
          await fill(1);
          while (candidates[0]?.entry.turn.acpBackground) {
            const background = candidates.shift();
            if (background) yield background.entry;
            await fill(1);
          }
          const matches = (candidate: (typeof candidates)[number]) =>
            messageId && candidate.entry.acpMessageId
              ? candidate.entry.acpMessageId === messageId
              : candidate.fingerprint === fingerprint ||
                (content.hasMedia &&
                  candidate.fingerprint ===
                    (legacyFingerprint ??= content.fingerprint(turn, undefined, true)));
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
            const consumed = candidates.splice(0, index + 1);
            for (const candidate of consumed) {
              if (candidate.entry.turn.acpBackground) yield candidate.entry;
            }
            const matched = consumed.at(-1);
            if (matched && matched.fingerprint !== fingerprint) {
              // Agent 重放补齐了断线后的输出。保留本地回合身份、发送时间和原始用户附件。
              const old = matched.entry.turn;
              const user = old.items.find(
                (item) => item.type === "message" && item.role === "user",
              );
              const projected = await content.materialize(turn, attachments, taskId);
              const firstUser = projected.items.find(
                (item) => item.type === "message" && item.role === "user",
              );
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
                  items: mergeCompactions(projected.items, old.items, false).map((item) =>
                    user && item === firstUser && !old.id.startsWith("acp:history:") ? user : item,
                  ),
                },
                replayFingerprint: fingerprint,
                ...(messageId ? { acpMessageId: messageId } : {}),
              };
            } else if (matched) {
              const missing = turn.items.filter(
                (item) =>
                  isAcpDiffItem(item) &&
                  !matched.entry.turn.items.some((old) => old.id === item.id),
              );
              const childItems = turn.items.some(isReplaySubagentItem)
                ? (await content.materialize(turn, attachments, taskId)).items.filter(
                    isReplaySubagentItem,
                  )
                : [];
              const childIds = new Set(childItems.map((item) => item.id));
              const hasCompactions = turn.items.some((item) => item.type === "compaction");
              yield missing.length || hasCompactions || childItems.length
                ? {
                    ...matched.entry,
                    turn: {
                      ...matched.entry.turn,
                      items: [
                        ...mergeCompactions(matched.entry.turn.items, turn.items, true).filter(
                          (item) => !childIds.has(item.id),
                        ),
                        ...missing,
                        ...childItems,
                      ],
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
              : turn !== projected || content.hasMedia
                ? { replayFingerprint: fingerprint }
                : {}),
          } satisfies AcpHistoryEntry;
        }
        while (await fill(1)) {
          const remaining = candidates.shift();
          if (remaining?.entry.turn.acpBackground) yield remaining.entry;
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
  update(update: SessionUpdate, subagent?: AcpSubagentItem): Promise<void> {
    if (subagent) {
      this.#subagentUpdates.set(update, subagent);
      return this.#writer.write(update);
    }
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
      case "session_message":
      case "session_message_chunk":
      case "compaction_update":
      case "compaction_summary_chunk":
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
      const subagent = this.#subagentUpdates.get(update);
      if (subagent) {
        this.#flushUserPrefix();
        this.#current ??= this.#createProjection(String(++this.#counter));
        if (update.sessionUpdate === "subagent_update") this.#current.announceSubagent(subagent);
        else await this.#current.ingest(update, subagent);
        next = await reader.read();
        continue;
      }
      const user = userUpdate(update);
      if (user && this.#userId !== undefined && this.#userId !== user.messageId) {
        const id = user.messageId ?? "user";
        const steering = this.#firstUserId
          ? await findSteering(this.#firstUserId, id, this.#steeringCount)
          : undefined;
        if (steering) {
          // 只暂存一条待确认的用户消息，折叠分块与全量替换，并对缓冲设置上限。
          const candidate = await readSteeringCandidate(
            user,
            () => reader.read(),
            (value) => !this.#subagentUpdates.has(value),
          );
          next = candidate.next;
          if (await matchesSteering(candidate.text, steering, attachments, this.taskId)) {
            this.#flushUserPrefix();
            this.#current?.userMessage(steering.id, steering.text, steering.attachments ?? []);
            this.#userId = id;
            this.#steeringCount++;
          } else {
            const turn = this.#finishTurn();
            if (turn) yield turn;
            for (const update of candidate.updates()) await this.#applyUpdate(update);
          }
          continue;
        }
        const turn = this.#finishTurn();
        if (turn) yield turn;
      }
      await this.#applyUpdate(update);
      next = await reader.read();
    }
    const turn = this.#finishTurn();
    if (turn) yield turn;
  }

  async #applyUpdate(update: SessionUpdate): Promise<void> {
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
    } else if (
      update.sessionUpdate === "agent_message_chunk" ||
      update.sessionUpdate === "compaction_update" ||
      update.sessionUpdate === "compaction_summary_chunk"
    ) {
      this.#flushUserPrefix();
    }
    this.#current ??= this.#createProjection(this.#userId ?? String(++this.#counter));
    await this.#current.ingest(update);
  }
  #flushUserPrefix(): void {
    const text = this.#userPrefix;
    this.#userPrefix = undefined;
    // 前缀残缺时按普通用户文本保留，避免截断用户实际输入。
    if (!text) return;
    this.#current ??= this.#createProjection(this.#userId ?? String(++this.#counter));
    this.#current.update({
      sessionUpdate: "user_message_chunk",
      messageId: this.#userId ?? "user",
      content: { type: "text", text },
    });
  }
  #createProjection(id: string): AcpEventProjection {
    return new AcpEventProjection(
      this.taskId,
      `acp:history:${id}`,
      () => undefined,
      false,
      () => this.#attachments,
    );
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
