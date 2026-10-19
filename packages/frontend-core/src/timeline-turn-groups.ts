import type { AgentTurn } from "@codexly/protocol";
import type { TimelineNavigationState } from "./timeline-navigation.js";

export interface TimelineTurnGroup {
  /** 使用首个原生回合做稳定列表键，自动续跑时不重挂已有回复。 */
  id: string;
  turnIds: string[];
}

/** Claude 的无用户输入续跑与前一阶段共用回复；只读索引和消息角色，不物化流式正文。 */
export function groupTimelineTurns(
  state: TimelineNavigationState<{ type: string; role?: string }>,
  engine: string | undefined,
): TimelineTurnGroup[] {
  const groups: TimelineTurnGroup[] = [];
  for (const turnId of state.turnIds) {
    const hasUserInput = (state.itemKeysByTurnId[turnId] ?? []).some((key) => {
      const item = state.itemStoresByKey.get(key)?.peek();
      return item?.type === "review" || (item?.type === "message" && item.role === "user");
    });
    const previous = groups.at(-1);
    if (engine === "claude" && previous && !hasUserInput) previous.turnIds.push(turnId);
    else groups.push({ id: turnId, turnIds: [turnId] });
  }
  return groups;
}

/** 仅组合展示元数据，末次回合身份用于分叉；所有原生过程游标仍由调用方逐一保留。 */
export function mergeTimelineTurns<T extends Omit<AgentTurn, "items">>(
  turns: readonly T[],
): T | undefined {
  const first = turns[0],
    last = turns.at(-1);
  if (!first || !last || turns.length === 1) return first;
  return {
    ...last,
    startedAt: first.startedAt,
    itemTimings: turns.reduce<NonNullable<AgentTurn["itemTimings"]>>(
      (timings, turn) => ({ ...timings, ...turn.itemTimings }),
      {},
    ),
    error: turns.flatMap((turn) => (turn.error ? [turn.error] : [])).join("\n") || null,
  };
}
