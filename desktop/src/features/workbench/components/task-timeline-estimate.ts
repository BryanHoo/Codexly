import { useCallback } from "react";

import type { TaskStore } from "../../conversation/runtime/task-store.js";

const TIMELINE_ITEM_ESTIMATED_HEIGHT_PX = 900;

export function useTurnSizeEstimate(store: TaskStore, itemStructureRevision: number) {
  return useCallback(
    (turnId: string) => {
      // TanStack 建议动态列表采用偏大的估算；按 Item 数避免超大 Turn 首跳落入历史中段。
      void itemStructureRevision;
      const itemCount = store.getState().itemKeysByTurnId[turnId]?.length ?? 1;
      return Math.max(1, itemCount) * TIMELINE_ITEM_ESTIMATED_HEIGHT_PX;
    },
    [itemStructureRevision, store],
  );
}
