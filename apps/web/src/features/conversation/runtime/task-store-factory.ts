import {
  browserInterruptedReplyStorage,
  type InterruptedReplyStorage,
} from "@codexly/frontend-core/interrupted-replies";
import { createTaskStoreRuntime } from "@codexly/frontend-core/task-store-runtime";
import type { AgentEvent, AgentItem, AgentTaskSettings, PendingRequest } from "@codexly/protocol";
import { createStore } from "zustand/vanilla";

import {
  normalizeSnapshot,
  updateCommandOutputBudget,
  type TaskItemStore,
  type TaskSnapshotMetadata,
  type TaskStore,
  type TaskStoreHydrationResponse,
  type TaskStoreIdentity,
  type TaskStoreState,
} from "./task-store-core.js";
import { applyAcceptedEvent, isPersistentNotice } from "./task-store-events.js";

export function createTaskStore(
  identity: TaskStoreIdentity,
  initialResponse?: TaskStoreHydrationResponse,
  replyStorage: InterruptedReplyStorage | undefined = browserInterruptedReplyStorage(),
): TaskStore {
  return createStore<TaskStoreState>()((set, get) => ({
    ...createTaskStoreRuntime<
      AgentItem,
      TaskItemStore,
      PendingRequest,
      TaskSnapshotMetadata,
      AgentTaskSettings,
      AgentEvent
    >(
      {
        identity,
        initialResponse,
        replyStorage,
        normalizeSnapshot,
        applyAcceptedEvent,
        updateCommandOutputBudget,
        isPersistentNotice,
      },
      set,
      get,
    ),
  }));
}
