import type { AgentTaskSnapshot, AgentTurn } from "@/protocol/index.js";
import { shallow } from "zustand/shallow";
import type { TaskStoreState } from "./task-store.js";

export type InspectorTask = Pick<AgentTaskSnapshot, "goal" | "plan" | "turns">;

export function selectTaskRuntimeMetadata(state: TaskStoreState) {
  const metadata = state.snapshotMetadata;
  if (metadata === null) return undefined;
  // 时间戳仅供按需读取；流式活动时间变化不应触发工作台重绘。
  return {
    id: metadata.id,
    title: metadata.title,
    status: metadata.status,
    settings: metadata.settings,
    threadConfiguration: metadata.threadConfiguration,
    contextUsage: metadata.contextUsage,
    goal: metadata.goal,
  };
}

export function createInspectorTaskSelector() {
  let revision = -1;
  let itemStores: TaskStoreState["itemStoresByKey"] | undefined;
  let turns: AgentTurn[] = [];
  let previous: InspectorTask | undefined;
  return (state: TaskStoreState): InspectorTask | undefined => {
    const metadata = state.snapshotMetadata;
    if (metadata === null) return undefined;
    if (revision !== state.itemStructureRevision || itemStores !== state.itemStoresByKey) {
      revision = state.itemStructureRevision;
      itemStores = state.itemStoresByKey;
      const cachedTurns = new Map(turns.map((turn) => [turn.id, turn]));
      // 仅结构或完整 Item 更新时收集来源与子任务，peek 不物化流式正文。
      const nextTurns = state.turnIds.flatMap((turnId) => {
        const turn = state.turnsById[turnId];
        if (turn === undefined) return [];
        const items = (state.itemKeysByTurnId[turnId] ?? []).flatMap((key) => {
          const item = state.itemStoresByKey.get(key)?.peek();
          return item?.type === "tool" || (item?.type === "message" && item.role === "user")
            ? [item] : [];
        });
        if (items.length === 0) return [];
        const cached = cachedTurns.get(turnId);
        return [cached !== undefined && shallow(cached.items, items) ? cached : { ...turn, items }];
      });
      if (!shallow(turns, nextTurns)) turns = nextTurns;
    }
    if (previous?.turns === turns && previous.goal === metadata.goal && previous.plan === metadata.plan) {
      return previous;
    }
    previous = { goal: metadata.goal, plan: metadata.plan, turns };
    return previous;
  };
}
