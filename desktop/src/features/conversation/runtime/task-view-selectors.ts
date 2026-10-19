import type { AgentItem } from "@/protocol/index.js";
import {
  createInspectorTaskSelector as createSharedInspectorTaskSelector,
  type InspectorTask as SharedInspectorTask,
} from "@codexly/frontend-core/task-view-selectors";

export { selectTaskRuntimeMetadata } from "@codexly/frontend-core/task-view-selectors";
export type InspectorTask = SharedInspectorTask<AgentItem>;

// 复用共享缓存与筛选规则，同时保留原生 Item 的扩展字段。
export const createInspectorTaskSelector = () => createSharedInspectorTaskSelector<AgentItem>();
