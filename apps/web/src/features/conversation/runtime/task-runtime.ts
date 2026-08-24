import {
  stripLeadingAgentSkillReferences,
  type AgentEvent,
  type AgentItem,
  type AgentMessageAttachment,
  type AgentPromptInput,
  type AgentTaskSnapshot,
  type AgentTurn,
  type PendingRequest,
} from "@code-agent/protocol";

const MAX_BUFFERED_DELTA_BYTES = 1_048_576;
const MAX_BUFFERED_DELTA_EVENTS = 1_000;
const textEncoder = new TextEncoder();

// HTTP Snapshot 只含 pending；实时会话额外保留本次连接内的终态展示。
export type RuntimeTaskSnapshot = Omit<AgentTaskSnapshot, "pendingRequests"> &
  Readonly<{ pendingRequests: readonly PendingRequest[] }>;

function normalizeSubmittedSkillText(turn: AgentTurn): AgentTurn {
  const items = turn.items.map((item): AgentItem => {
    if (item.type !== "message" || item.role !== "user" || (item.skills?.length ?? 0) === 0) {
      return item;
    }
    const text = stripLeadingAgentSkillReferences(item.text, item.skills ?? []);
    if (text === item.text) {
      return item;
    }
    return { ...item, text };
  });

  // turn/start 可能先返回已结构化的 Skill，同时仍保留同名 `$name` 正文。
  return items.some((item, index) => item !== turn.items[index]) ? { ...turn, items } : turn;
}

export function mergeSubmittedPromptIntoSnapshot(
  snapshot: RuntimeTaskSnapshot,
  submittedTurn: AgentTurn,
  input: Pick<AgentPromptInput, "attachments" | "skills" | "text"> &
    Readonly<{ messageAttachments?: readonly AgentMessageAttachment[] }>,
): RuntimeTaskSnapshot {
  const normalizedSubmittedTurn = normalizeSubmittedSkillText(submittedTurn);
  const submittedUserMessage = normalizedSubmittedTurn.items.find(
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
  const turnIndex = snapshot.turns.findIndex((turn) => turn.id === normalizedSubmittedTurn.id);
  const snapshotTurn = snapshot.turns[turnIndex];
  const currentTurn = normalizeSubmittedSkillText(snapshotTurn ?? normalizedSubmittedTurn);
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
      if (currentTurn === snapshotTurn) {
        return snapshot;
      }
      const turns = [...snapshot.turns];
      turns[turnIndex] = currentTurn;
      return { ...snapshot, turns };
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
  { type: "command.output_delta" | "message.delta" | "plan.delta" | "reasoning.delta" }
> {
  return (
    event.type === "message.delta" ||
    event.type === "plan.delta" ||
    event.type === "reasoning.delta" ||
    event.type === "command.output_delta"
  );
}

function deltaKey(event: Extract<AgentEvent, { itemId: string }>): string {
  const field =
    event.type === "reasoning.delta"
      ? `${event.payload.field}:${String(event.payload.sectionIndex ?? -1)}`
      : "value";
  return `${event.taskId}:${event.turnId}:${event.itemId}:${event.type}:${field}`;
}

type BufferedDeltaEvent = Readonly<{
  event: Extract<
    AgentEvent,
    { type: "command.output_delta" | "message.delta" | "plan.delta" | "reasoning.delta" }
  >;
  retainedBytes: number;
}>;

export class AgentEventBuffer {
  readonly #maxBytes: number;
  readonly #maxEvents: number;
  readonly #events: BufferedDeltaEvent[] = [];
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
    if (!isDeltaEvent(event)) {
      throw new TypeError("Only Agent Event deltas can be buffered");
    }
    const key = deltaKey(event);
    const previousEntry = this.#events.at(-1);
    const previous = previousEntry?.event;
    const mergesPrevious = previous !== undefined && deltaKey(previous) === key;
    const deltaBytes = textEncoder.encode(event.payload.delta).byteLength;
    const nextEventCount = this.#events.length + (mergesPrevious ? 0 : 1);
    if (nextEventCount > this.#maxEvents || this.#bufferedBytes + deltaBytes > this.#maxBytes) {
      // 溢出后丢弃未确认 Delta，由调用方取消订阅并通过 Snapshot 恢复。
      this.#events.length = 0;
      this.#bufferedBytes = 0;
      return false;
    }
    this.#bufferedBytes += deltaBytes;
    if (!mergesPrevious) {
      this.#events.push({ event, retainedBytes: deltaBytes });
      return true;
    }
    // 仅合并相邻 Delta，避免跨 Item 覆盖较早事件并改变 Timeline 顺序。
    this.#events[this.#events.length - 1] = {
      event: {
        ...event,
        payload: { ...event.payload, delta: `${previous.payload.delta}${event.payload.delta}` },
      } as BufferedDeltaEvent["event"],
      retainedBytes: (previousEntry?.retainedBytes ?? 0) + deltaBytes,
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
}
