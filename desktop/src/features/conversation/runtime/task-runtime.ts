import {
  type AgentEvent,
  type AgentMessageAttachment,
  type AgentPromptInput,
  type AgentTaskSnapshot,
  type AgentTurn,
  type PendingRequest,
} from "@/protocol/index.js";
import { estimateRetainedBytes } from "../../../shared/memory/byte-lru.js";

const MAX_BUFFERED_DELTA_BYTES = 1_048_576;
const MAX_BUFFERED_DELTA_EVENTS = 1_000;
const textEncoder = new TextEncoder();

// HTTP Snapshot 只含 pending；实时会话额外保留本次连接内的终态展示。
export type RuntimeTaskSnapshot = Omit<AgentTaskSnapshot, "pendingRequests"> &
  Readonly<{ pendingRequests: readonly PendingRequest[] }>;

export function mergeSubmittedPromptIntoSnapshot(
  snapshot: RuntimeTaskSnapshot,
  submittedTurn: AgentTurn,
  input: Pick<AgentPromptInput, "attachments" | "skills" | "text"> &
    Readonly<{ messageAttachments?: readonly AgentMessageAttachment[] }>,
): RuntimeTaskSnapshot {
  // 原生回合已统一规范化 Skill；这里只补齐本次提交的乐观展示数据。
  const submittedUserMessage = submittedTurn.items.find(
    (item) => item.type === "message" && item.role === "user",
  );
  if (
    input.text.length === 0 &&
    input.skills.length === 0 &&
    input.attachments.length === 0 &&
    submittedUserMessage === undefined
  ) {
    return snapshot;
  }
  const turnIndex = snapshot.turns.findIndex((turn) => turn.id === submittedTurn.id);
  const snapshotTurn = snapshot.turns[turnIndex];
  const currentTurn = snapshotTurn ?? submittedTurn;
  const currentUserMessageIndex = currentTurn.items.findIndex(
    (item) => item.type === "message" && item.role === "user",
  );
  const currentUserMessage = currentTurn.items[currentUserMessageIndex];
  const alreadyContainsUserMessage = currentUserMessageIndex >= 0;
  if (turnIndex >= 0 && currentUserMessage?.type === "message") {
    if (
      (currentUserMessage.attachments?.length ?? 0) > 0 ||
      (input.messageAttachments?.length ?? 0) === 0
    ) {
      return snapshot;
    }
    // Runtime 可能先创建空用户 Item；在权威附件到达前补齐本地上传元数据。
    const turns = [...snapshot.turns];
    const items = [...currentTurn.items];
    items[currentUserMessageIndex] = {
      ...currentUserMessage,
      attachments: [...(input.messageAttachments ?? [])],
      ...(input.text.length === 0 ? { text: "" } : {}),
    };
    turns[turnIndex] = { ...currentTurn, items };
    return { ...snapshot, turns };
  }

  // Provider 的运行中 Snapshot 可能暂时缺少用户项；保留本次提交直到权威消息到达。
  const mergedTurn: AgentTurn = alreadyContainsUserMessage
    ? currentTurn
    : {
        ...currentTurn,
        items: [
          submittedUserMessage ?? {
            id: `submitted-user-${submittedTurn.id}`,
            role: "user",
            ...(input.skills.length === 0
              ? {}
              : { skills: input.skills.map((skill) => ({ name: skill.name })) }),
            ...((input.messageAttachments?.length ?? 0) === 0
              ? {}
              : { attachments: [...(input.messageAttachments ?? [])] }),
            text: input.text,
            type: "message",
          },
          ...currentTurn.items,
        ],
      };
  if (turnIndex < 0) {
    return {
      ...snapshot,
      status: "running",
      turns: [...snapshot.turns, mergedTurn],
    };
  }
  const turns = [...snapshot.turns];
  turns[turnIndex] = mergedTurn;
  return {
    ...snapshot,
    turns,
  };
}

function isDeltaEvent(
  event: AgentEvent,
): event is Extract<
  AgentEvent,
  { type: "command.output_delta" | "message.delta" | "plan.delta" }
> {
  return (
    event.type === "message.delta" ||
    event.type === "reasoning.delta" ||
    event.type === "plan.delta" ||
    event.type === "command.output_delta"
  );
}

function deltaKey(event: Extract<AgentEvent, { itemId: string }>): string {
  return `${event.taskId}:${event.turnId}:${event.itemId}:${event.type}`;
}

type BufferedAgentEvent = Readonly<{
  event: AgentEvent;
  retainedBytes: number;
}>;

export class AgentEventBuffer {
  readonly #maxBytes: number;
  readonly #maxEvents: number;
  readonly #events: BufferedAgentEvent[] = [];
  #bufferedBytes = 0;

  public constructor(options: Readonly<{ maxBytes?: number; maxEvents?: number }> = {}) {
    this.#maxBytes = options.maxBytes ?? MAX_BUFFERED_DELTA_BYTES;
    this.#maxEvents = options.maxEvents ?? MAX_BUFFERED_DELTA_EVENTS;
    if (!Number.isInteger(this.#maxBytes) || this.#maxBytes <= 0) {
      throw new RangeError("Agent Event buffer maxBytes must be a positive integer");
    }
    if (!Number.isInteger(this.#maxEvents) || this.#maxEvents <= 0) {
      throw new RangeError("Agent Event buffer maxEvents must be a positive integer");
    }
  }

  public push(event: AgentEvent): boolean {
    const previousEntry = this.#events.at(-1);
    const previous = previousEntry?.event;
    const mergesPrevious =
      isDeltaEvent(event) &&
      previous !== undefined &&
      isDeltaEvent(previous) &&
      deltaKey(previous) === deltaKey(event);
    const eventBytes = isDeltaEvent(event)
      ? textEncoder.encode(event.payload.delta).byteLength
      : estimateRetainedBytes(event);
    const nextEventCount = this.#events.length + (mergesPrevious ? 0 : 1);
    if (nextEventCount > this.#maxEvents || this.#bufferedBytes + eventBytes > this.#maxBytes) {
      // 溢出后丢弃未确认事件，由调用方通过 Snapshot 恢复。
      this.#events.length = 0;
      this.#bufferedBytes = 0;
      return false;
    }
    this.#bufferedBytes += eventBytes;
    if (!mergesPrevious) {
      this.#events.push({ event, retainedBytes: eventBytes });
      return true;
    }
    if (!isDeltaEvent(event) || previous === undefined || !isDeltaEvent(previous)) return true;
    // 仅合并相邻 Delta，避免跨 Item 覆盖较早事件并改变 Timeline 顺序。
    this.#events[this.#events.length - 1] = {
      event: {
        ...event,
        payload: { ...event.payload, delta: `${previous.payload.delta}${event.payload.delta}` },
      } as AgentEvent,
      retainedBytes: (previousEntry?.retainedBytes ?? 0) + eventBytes,
    };
    return true;
  }

  public drain(): AgentEvent[] {
    return this.flushThrough(Number.POSITIVE_INFINITY);
  }

  public flushThrough(sequence: number): AgentEvent[] {
    const retainedIndex = this.#events.findIndex(({ event }) => event.sequence >= sequence);
    const flushCount = retainedIndex < 0 ? this.#events.length : retainedIndex;
    const flushed = this.#events.splice(0, flushCount);
    for (const entry of flushed) {
      this.#bufferedBytes -= entry.retainedBytes;
    }
    return flushed.map(({ event }) => event);
  }

  public retainAfter(sessionId: string, sequence: number): void {
    const retained = this.#events.filter(
      ({ event }) => event.sessionId === sessionId && event.sequence > sequence,
    );
    this.#events.length = 0;
    this.#events.push(...retained);
    this.#bufferedBytes = retained.reduce((total, entry) => total + entry.retainedBytes, 0);
  }
}
