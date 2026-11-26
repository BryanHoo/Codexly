import type { AgentEvent, AgentItem, PendingRequest } from "@codexly/protocol";
import type { TaskEventState } from "@codexly/frontend-core/task-event-model";
import { createTaskEventReducer } from "@codexly/frontend-core/task-event-reducer";
import {
  MAX_RETAINED_TASK_NOTICES,
  PENDING_COMMAND_LABEL,
  createTaskItemStore,
  type TaskNotice,
  type TaskItemStore,
  type TaskSnapshotMetadata,
} from "./task-store-core.js";

type EventState = TaskEventState<PendingRequest, TaskSnapshotMetadata, TaskItemStore>;

export const isPersistentNotice = (notice: TaskNotice): boolean =>
  notice.payload.code === "runtime_warning" || notice.payload.code === "acp_notice";

function createDeltaItem(
  event: Extract<
    AgentEvent,
    { type: "message.delta" | "reasoning.delta" | "plan.delta" | "command.output_delta" }
  >,
): AgentItem | undefined {
  switch (event.type) {
    case "message.delta":
      return {
        id: event.itemId,
        role: "assistant",
        text: "",
        type: "message",
      };
    case "reasoning.delta":
      return {
        content: "",
        id: event.itemId,
        summary: "",
        type: "reasoning",
      };
    case "plan.delta":
      return {
        id: event.itemId,
        text: "",
        type: "plan",
      };
    case "command.output_delta": {
      return {
        command: PENDING_COMMAND_LABEL,
        cwd: "",
        id: event.itemId,
        output: "",
        outputOmitted: { bytes: 0, lines: 0 },
        status: "running",
        type: "command",
      };
    }
    default:
      return undefined;
  }
}

const reduceEvent = createTaskEventReducer<
  AgentItem,
  PendingRequest,
  TaskSnapshotMetadata,
  Extract<AgentEvent, { type: "reasoning.delta" }>["payload"],
  TaskItemStore
>({
  createItemStore: createTaskItemStore,
  createDeltaItem,
  createFileChangeItem: (event) => ({
    id: event.itemId,
    type: "file_change",
    status: "running",
    changes: event.payload.changes,
  }),
  // 自动审批另由 Item 呈现；仅 runtime_warning 跨回合留在上下文。
  retainNotice(notices, event) {
    if (event.payload.code === "guardian_warning") return notices;
    const next = [...notices, event];
    const transient = next.filter((notice) => notice.payload.code !== "runtime_warning");
    const discarded = new Set(transient.slice(0, -MAX_RETAINED_TASK_NOTICES));
    return next.filter((notice) => !discarded.has(notice));
  },
  isPersistentNotice,
  resolveCompletedTurn(current, incoming) {
    const error = current?.status === "failed" ? current.error : null;
    return incoming.error === null && error !== null ? { ...incoming, error } : incoming;
  },
});

export const applyAcceptedEvent: (
  state: EventState,
  event: AgentEvent,
  changedItemStores: Set<TaskItemStore>,
) => Partial<EventState> = reduceEvent;
