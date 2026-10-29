import type { AgentEvent, AgentTaskSnapshot, AgentTurn, TaskEventModel } from "@codexly/protocol";

export type TaskEventTurn = Omit<AgentTurn, "items">;
export type TaskEventNotice = Extract<AgentEvent, { type: "task.notice" }>;
export interface TaskReasoningPayload {
  delta: string;
  field?: "content" | "summary";
  sectionIndex?: number;
}
export type TaskDeltaEvent<Reasoning> = Extract<
  TaskEventModel<never, never, never, Reasoning>,
  {
    type: "message.delta" | "plan.delta" | "reasoning.delta" | "command.output_delta";
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
  "status" | "title" | "updatedAt" | "goal" | "plan" | "contextUsage" | "threadConfiguration"
>;

/** 只声明 reducer 实际读写的 Store 端口，Zustand、IPC 和网络由平台持有。 */
export interface TaskEventItemStore<Item, Reasoning> {
  read(): Item;
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
