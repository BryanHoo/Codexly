import type { AgentItem } from "@codexly/protocol";
import {
  createTaskItemKey,
  createTaskItemStore,
} from "../../conversation/runtime/task-store-core.js";
import { createTaskStore } from "../../conversation/runtime/task-store-factory.js";

export function questionItem(id: string, title = id): Extract<AgentItem, { type: "message" }> {
  return {
    id,
    type: "message",
    role: "assistant",
    text: title,
    questions: [{ title, options: ["当前文件", "整个项目"] }],
  };
}

export function questionTask(items: AgentItem[]) {
  const store = createTaskStore({ projectId: "project-a", taskId: "task-a" });
  store.setState({
    turnIds: ["turn-a"],
    itemKeysByTurnId: { "turn-a": items.map((item) => createTaskItemKey("turn-a", item.id)) },
    itemStoresByKey: new Map(
      items.map((item) => [createTaskItemKey("turn-a", item.id), createTaskItemStore(item)]),
    ),
  });
  return store;
}
