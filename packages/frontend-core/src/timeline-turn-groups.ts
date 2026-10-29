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
  previousGroups: TimelineTurnGroup[] = [],
): TimelineTurnGroup[] {
  const groups: TimelineTurnGroup[] = [];
  const previousById = new Map(previousGroups.map((group) => [group.id, group]));
  let start = 0;
  const appendGroup = (end: number) => {
    const id = state.turnIds[start];
    if (id === undefined) return;
    const previous = previousById.get(id);
    // 直接核对原生回合区间；只有成员变化才分配新对象和数组，且不修改旧渲染快照。
    groups.push(
      previous?.turnIds.length === end - start &&
        previous.turnIds.every((turnId, index) => turnId === state.turnIds[start + index])
        ? previous
        : { id, turnIds: state.turnIds.slice(start, end) },
    );
    start = end;
  };
  for (const [index, turnId] of state.turnIds.entries()) {
    if (index === 0) continue;
    // Codex 不合并原生回合，无须读取历史条目的角色。
    if (
      engine !== "claude" ||
      (state.itemKeysByTurnId[turnId] ?? []).some((key) => {
        const item = state.itemStoresByKey.get(key)?.peek();
        return item?.type === "review" || (item?.type === "message" && item.role === "user");
      })
    )
      appendGroup(index);
  }
  appendGroup(state.turnIds.length);
  return groups.length === previousGroups.length &&
    groups.every((group, index) => group === previousGroups[index])
    ? previousGroups
    : groups;
}

/** 每个时间线实例只保留上一版分组的 ID，随实例卸载释放，不缓存正文或跨任务累积。 */
export function createTimelineTurnGrouper() {
  let previousGroups: TimelineTurnGroup[] = [];
  return (
    state: TimelineNavigationState<{ type: string; role?: string }>,
    engine: string | undefined,
  ) => {
    previousGroups = groupTimelineTurns(state, engine, previousGroups);
    return previousGroups;
  };
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
