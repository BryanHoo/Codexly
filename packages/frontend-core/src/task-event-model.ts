import type { AgentEvent, AgentTaskSnapshot, AgentTurn, TaskEventModel } from "@codexly/protocol";

export type TaskEventTurn = Omit<AgentTurn, "items">;
export type TaskEventNotice = Extract<AgentEvent, { type: "task.notice" }>;
interface TurnOutputRateEvent {
  type: "message.delta" | "reasoning.delta";
  turnId: string;
  itemId: string;
  timestamp?: string;
  payload: { delta: string };
}

type StoreEventType = AgentEvent["type"] | "message.skills_updated";
type StoreEventWithPayload<Item> =
  | {
      type: "item.started" | "item.completed";
      turnId: string;
      itemId: string;
      payload: { item: Item };
    }
  | {
      type: "turn.completed";
      turnId: string;
      provider: string;
      payload: { turn: TaskEventTurn & { items: Item[] } };
    }
  | { type: "turn.started" | "provider.error"; turnId: string }
  | Extract<AgentEvent, { type: "usage.updated" }>
  | TurnOutputRateEvent;

export type TaskStoreEvent<Item> = {
  taskId: string;
  sessionId: string;
  sequence: number;
  turnId?: string;
  itemId?: string;
} & (
  | StoreEventWithPayload<Item>
  | { type: Exclude<StoreEventType, StoreEventWithPayload<Item>["type"]> }
);

export interface TaskReasoningPayload {
  delta: string;
  field?: "content" | "summary";
  sectionIndex?: number;
}
export type TaskDeltaEvent<Reasoning> = Extract<
  TaskEventModel<never, never, never, Reasoning>,
  {
    type:
      | "compaction.summary_delta"
      | "message.delta"
      | "plan.delta"
      | "reasoning.delta"
      | "command.output_delta";
  }
>;
export interface TaskEventItem {
  id: string;
  type: string;
  role?: string;
  identityAliases?: readonly string[];
}
export interface TaskEventRequest {
  requestId: string;
  status: string;
}
export type TaskEventMetadata = Pick<
  AgentTaskSnapshot,
  | "status"
  | "title"
  | "updatedAt"
  | "goal"
  | "plan"
  | "contextUsage"
  | "threadConfiguration"
  | "acpSession"
>;

/** 只声明 reducer 实际读写的 Store 端口，Zustand、IPC 和网络由平台持有。 */
export interface TaskEventItemStore<Item, Reasoning> {
  read(): Item;
  peek(): Item;
  replace(item: Item): void;
  appendDelta(event: TaskDeltaEvent<Reasoning>): boolean;
}
export interface TaskEventState<Request, Metadata, Store> {
  itemKeysByTurnId: Readonly<Record<string, readonly string[]>>;
  itemStoresByKey: Map<string, Store>;
  itemStructureRevision: number;
  notices: readonly TaskEventNotice[];
  pendingRequestIds: readonly string[];
  pendingRequestsById: Readonly<Record<string, Request>>;
  snapshotMetadata: Metadata | null;
  turnIds: readonly string[];
  turnsById: Readonly<Record<string, TaskEventTurn>>;
  checkpoint: { sequence: number; sessionId: string } | null;
}
