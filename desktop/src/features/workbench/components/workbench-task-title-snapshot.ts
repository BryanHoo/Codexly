import type { TaskStoreState } from "../../conversation/runtime/task-store.js";
import type { TaskTitleSnapshot } from "../../projects/project-queries.js";

export function selectTaskTitleSnapshot(
  state: TaskStoreState | undefined,
): TaskTitleSnapshot | undefined {
  const metadata = state?.snapshotMetadata;
  if (state === undefined || metadata === null || metadata === undefined) {
    return undefined;
  }
  return {
    id: metadata.id,
    projectId: metadata.projectId,
    title: metadata.title,
    turns: state.turnIds.flatMap((turnId) => {
      const turn = state.turnsById[turnId];
      if (turn === undefined) {
        return [];
      }
      const items = (state.itemKeysByTurnId[turnId] ?? []).flatMap((itemKey) => {
        const item = state.getItemByKey(itemKey);
        return item?.type === "message" ? [item] : [];
      });
      return [{ ...turn, items }];
    }),
    updatedAt: metadata.updatedAt,
  };
}
