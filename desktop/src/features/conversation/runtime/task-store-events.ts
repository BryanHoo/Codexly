import type { AgentEvent, AgentItem, PendingRequest } from "@/protocol/index.js";
import { createTaskEventReducer } from "@codexly/frontend-core/task-event-reducer";
import { touchedCommandOutputItemKeys as getTouchedCommandOutputItemKeys } from "@codexly/frontend-core";
import { createTaskItemKey } from "@codexly/frontend-core";
import {
  MAX_RETAINED_TASK_NOTICES,
  PENDING_COMMAND_LABEL,
  createTaskItemStore,
  type TaskItemStore,
  type TaskSnapshotMetadata,
  type TaskStoreState,
} from "./task-store-core.js";
export { getTouchedCommandOutputItemKeys };

function createDeltaItem(
  event: Extract<
    AgentEvent,
    { type: "message.delta" | "reasoning.delta" | "plan.delta" | "command.output_delta" }
  >,
): AgentItem | undefined {
  switch (event.type) {
    case "message.delta":
    case "reasoning.delta":
      if (event.type === "reasoning.delta")
        return { id: event.itemId, text: "", type: "reasoning" };
      return {
        id: event.itemId,
        role: "assistant",
        text: "",
        type: "message",
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
  // 原生上下文保留所有警告；普通通知限制数量并在回合结束后清除。
  retainNotice(notices, event) {
    const next = [...notices, event];
    if (
      event.payload.level !== "warning" &&
      next.filter((notice) => notice.payload.level !== "warning").length > MAX_RETAINED_TASK_NOTICES
    ) {
      next.splice(
        next.findIndex((notice) => notice.payload.level !== "warning"),
        1,
      );
    }
    return next;
  },
  isPersistentNotice: (notice) => notice.payload.level === "warning",
  // Rust 已归并错误，null 也是权威结果，前端不得用旧错误覆盖。
  resolveCompletedTurn: (_current, incoming) => incoming,
});

export function applyAcceptedEvent(
  state: TaskStoreState,
  event: AgentEvent,
  changedItemStores: Set<TaskItemStore>,
): Partial<TaskStoreState> {
  if (event.type === "message.skills_updated") {
    if (state.snapshotMetadata === null) return {};
    const itemStore = state.itemStoresByKey.get(createTaskItemKey(event.turnId, event.itemId));
    const item = itemStore?.read();
    if (itemStore !== undefined && item?.type === "message" && item.role === "user") {
      // 原生关联结果只补丁正文和技能，附件、身份与时间线位置保持不变。
      itemStore.replace({ ...item, text: event.payload.text, skills: event.payload.skills });
      changedItemStores.add(itemStore);
    }
    return {
      checkpoint: { sequence: event.sequence, sessionId: event.sessionId },
      snapshotMetadata: { ...state.snapshotMetadata, updatedAt: event.timestamp },
    };
  }
  return reduceEvent(state, event, changedItemStores);
}
