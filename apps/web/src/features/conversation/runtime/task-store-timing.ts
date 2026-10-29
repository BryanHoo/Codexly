import type { AgentEvent } from "@codexly/protocol";
import { recordToolItemTiming as recordTiming } from "@codexly/frontend-core/task-event-timing";
import type { NormalizedAgentTurn } from "./task-store-core.js";

export { mergeTurnItemTimings } from "@codexly/frontend-core/task-snapshot";
export { retainTurnItemTimings } from "@codexly/frontend-core/task-event-timing";

// 在兼容入口绑定平台事件类型；具体计时规则由共享模块维护。
export const recordToolItemTiming: (
  turn: NormalizedAgentTurn,
  event: Extract<AgentEvent, { type: "item.started" | "item.completed" }>,
) => NormalizedAgentTurn = recordTiming;
