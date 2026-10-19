import type { AgentItem, AgentTaskSnapshot, AgentTurn } from "@codexly/protocol";

// 仅声明两端投影所需的结构，不依赖平台 Store、React 或 Zustand。
type ViewItem = Readonly<{ type: string; role?: string }>;

export type TaskViewStoreState<TItem extends ViewItem = AgentItem> = Readonly<{
  snapshotMetadata: Omit<AgentTaskSnapshot, "pendingRequests" | "turns" | "turnsNextCursor"> | null;
  itemStructureRevision: number;
  itemStoresByKey: ReadonlyMap<string, Readonly<{ peek: () => TItem }>>;
  turnIds: readonly string[];
  turnsById: Readonly<Record<string, Omit<AgentTurn, "items">>>;
  itemKeysByTurnId: Readonly<Record<string, readonly string[]>>;
}>;

function sameEntries<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

export type InspectorTask<TItem extends ViewItem = AgentItem> = Pick<
  AgentTaskSnapshot,
  "goal" | "plan" | "contextUsage"
> &
  Readonly<{ turns: (Omit<AgentTurn, "items"> & { items: TItem[] })[] }>;

export type TaskRuntimeMetadata = Pick<
  AgentTaskSnapshot,
  | "id"
  | "engine"
  | "workspacePath"
  | "title"
  | "status"
  | "settings"
  | "threadConfiguration"
  | "contextUsage"
  | "goal"
>;

export function selectTaskRuntimeMetadata(
  state: Pick<TaskViewStoreState, "snapshotMetadata">,
): TaskRuntimeMetadata | undefined {
  const metadata = state.snapshotMetadata;
  if (metadata === null) return undefined;
  // 时间戳仅供按需读取；流式活动时间变化不应触发工作台重绘。
  return {
    id: metadata.id,
    ...(metadata.engine === undefined ? {} : { engine: metadata.engine }),
    ...(metadata.workspacePath === undefined ? {} : { workspacePath: metadata.workspacePath }),
    title: metadata.title,
    status: metadata.status,
    settings: metadata.settings,
    ...(metadata.threadConfiguration === undefined
      ? {}
      : { threadConfiguration: metadata.threadConfiguration }),
    contextUsage: metadata.contextUsage,
    goal: metadata.goal,
  };
}

// Item 保留调用端类型，兼容桌面原生扩展；筛选只依赖 type 与 role。
export function createInspectorTaskSelector<TItem extends ViewItem = AgentItem>() {
  let revision = -1;
  let itemStores: TaskViewStoreState<TItem>["itemStoresByKey"] | undefined;
  let turns: InspectorTask<TItem>["turns"] = [];
  let previous: InspectorTask<TItem> | undefined;
  return (state: TaskViewStoreState<TItem>): InspectorTask<TItem> | undefined => {
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
            ? [item]
            : [];
        });
        if (items.length === 0) return [];
        const cached = cachedTurns.get(turnId);
        return [
          cached !== undefined && sameEntries(cached.items, items) ? cached : { ...turn, items },
        ];
      });
      if (!sameEntries(turns, nextTurns)) turns = nextTurns;
    }
    if (
      previous?.turns === turns &&
      previous.goal === metadata.goal &&
      previous.plan === metadata.plan &&
      previous.contextUsage === metadata.contextUsage
    ) {
      return previous;
    }
    previous = {
      goal: metadata.goal,
      plan: metadata.plan,
      contextUsage: metadata.contextUsage,
      turns,
    };
    return previous;
  };
}
